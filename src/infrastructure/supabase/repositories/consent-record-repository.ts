// INVARIANT (WAQ-004): SOLE writer to consent_records (service-role bypass;
// table has no INSERT/UPDATE policies). Route every mutation through here.

import { randomUUID } from 'node:crypto'
import { createServerSupabaseClient } from '../client'
import { ConsentRecord } from '@/domain/entities/consent-record'
import {
  ConsentImportError,
  type ConsentRecordRepository,
} from '@/domain/repositories/consent-record-repository'
import type {
  ConsentCategory,
  ConsentGrade,
} from '@/domain/value-objects/consent-status'
import type { ConsentLevel, PartnerConsentCategory } from '@/domain/value-objects/consent-level'
import type { PartnerConsentAction } from '@/domain/value-objects/partner-consent-action'
import {
  decidePartnerConsentAction,
  insertedRowStatus,
} from '@/domain/services/partner-consent-policy'
import {
  toEntity,
  toRow,
  type ConsentRecordRow,
} from './consent-record-mapper'

const PARTNER_API_SOURCE = 'partner_api'

const ACTIVE_STATUSES = ['opted_in', 'pending'] as const

// I-3: a ConsentImportError's message used to embed the full E.164 phone
// number, which propagates uncaught into process-member-create-job.ts's
// job-row error_message / Slack alert / worker `.on('failed')` log (T-H7's
// "no PII in the job row/Slack" invariant). Last 4 digits only, same
// discriminator the job row itself already carries (`phone_last4`).
function maskPhoneForError(phoneE164: string): string {
  return `***${phoneE164.slice(-4)}`
}

interface FindActiveArgs {
  restaurantId: string
  phoneE164: string
  category: ConsentCategory
}

export async function findActiveConsent(
  args: FindActiveArgs
): Promise<ConsentRecord | null> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from('consent_records')
    .select('*')
    .eq('restaurant_id', args.restaurantId)
    .eq('phone_e164', args.phoneE164)
    .eq('category', args.category)
    .in('status', ACTIVE_STATUSES as unknown as string[])
    .order('captured_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(`findActiveConsent: ${error.message}`)
  if (!data) return null
  return toEntity(data as ConsentRecordRow)
}

interface FindBulkArgs {
  restaurantId: string
  phones: string[]
}

// Bulk active-marketing-consent lookup keyed by phone_e164 in ONE round-trip
// (kills N+1 from the campaign batch send). Most recent row wins per phone.
export async function findActiveMarketingConsentForPhones(
  args: FindBulkArgs
): Promise<Map<string, ConsentRecord>> {
  if (args.phones.length === 0) return new Map()
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from('consent_records')
    .select('*')
    .eq('restaurant_id', args.restaurantId)
    .eq('category', 'marketing')
    .in('status', ACTIVE_STATUSES as unknown as string[])
    .in('phone_e164', args.phones)
  if (error) throw new Error(`findActiveMarketingConsentForPhones: ${error.message}`)
  return buildLatestByPhone((data ?? []) as ConsentRecordRow[])
}

function buildLatestByPhone(
  rows: ConsentRecordRow[]
): Map<string, ConsentRecord> {
  const out = new Map<string, ConsentRecord>()
  for (const row of rows) {
    const prev = out.get(row.phone_e164)
    if (!prev || row.captured_at > prev.snapshot.capturedAt) {
      out.set(row.phone_e164, toEntity(row))
    }
  }
  return out
}

// INT-001 T-C1: latest row across ALL statuses (unlike findActiveConsent,
// which only sees opted_in/pending) -- the partner path must see a STOP.
export async function findLatestConsentByCategory(
  args: FindActiveArgs
): Promise<ConsentRecord | null> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from('consent_records')
    .select('*')
    .eq('restaurant_id', args.restaurantId)
    .eq('phone_e164', args.phoneE164)
    .eq('category', args.category)
    .order('captured_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(`findLatestConsentByCategory: ${error.message}`)
  if (!data) return null
  return toEntity(data as ConsentRecordRow)
}

export async function insertConsentRecord(
  record: ConsentRecord
): Promise<void> {
  const supabase = createServerSupabaseClient()
  const { error } = await supabase
    .from('consent_records')
    .insert(toRow(record))
  if (!error) return
  if ((error as { code?: string }).code === '23505') {
    throw new ConsentImportError(
      'duplicate_active',
      `consent already exists for (${record.snapshot.restaurantId}, ${maskPhoneForError(record.snapshot.phoneE164)}, ${record.snapshot.category})`
    )
  }
  throw new Error(`insertConsentRecord: ${error.message}`)
}

// INT-001 WI-13 (Gap A): identical write to insertConsentRecord, but routed
// through an RPC (migration 073) that also sets app.origin_integration_id
// for the SAME transaction the INSERT runs in -- consent_changed_outbox
// reads that setting so the resulting member.updated event is attributed
// to the calling integration. A plain `.insert()` can't do this: this
// repo's Supabase client talks over PostgREST, which runs every request in
// its OWN transaction, so a "set the session var" call made separately
// would already be gone by the time this insert's transaction begins.
// Used ONLY by applyPartnerAssertedConsent below (the partner-API-only
// write path) -- every other caller of insertConsentRecord is untouched
// and keeps writing member.updated with origin_integration_id NULL.
export async function insertConsentRecordWithOrigin(
  record: ConsentRecord,
  originIntegrationId: string
): Promise<void> {
  const supabase = createServerSupabaseClient()
  const { error } = await supabase.rpc('insert_consent_record_with_origin', {
    p_row: toRow(record),
    p_origin_integration_id: originIntegrationId,
  })
  if (!error) return
  if ((error as { code?: string }).code === '23505') {
    throw new ConsentImportError(
      'duplicate_active',
      `consent already exists for (${record.snapshot.restaurantId}, ${maskPhoneForError(record.snapshot.phoneE164)}, ${record.snapshot.category})`
    )
  }
  throw new Error(`insertConsentRecordWithOrigin: ${error.message}`)
}

interface UpgradeArgs {
  restaurantId: string
  phoneE164: string
  category: ConsentCategory
}

// WONB-005: idempotent pending→opted_in flip. Stamps `granted_at` (explicit
// grant moment for WONB-007/008 analytics). True iff a pending row was upgraded.
export async function upgradeToOptedIn(args: UpgradeArgs): Promise<boolean> {
  const supabase = createServerSupabaseClient()
  // count belongs on .update() — .select() after an update takes no options,
  // so the old `.select('id', { count: 'exact' })` never sent the count
  // preference: count was always null and this function always returned false.
  const { count, error } = await supabase
    .from('consent_records')
    .update(
      { status: 'opted_in', granted_at: new Date().toISOString() },
      { count: 'exact' }
    )
    .eq('restaurant_id', args.restaurantId)
    .eq('phone_e164', args.phoneE164)
    .eq('category', args.category)
    .eq('status', 'pending')
  if (error) throw new Error(`upgradeToOptedIn: ${error.message}`)
  return (count ?? 0) > 0
}

// INT-001 WI-13 (Gap A): origin-attributed sibling of upgradeToOptedIn --
// see insertConsentRecordWithOrigin's header above for why an RPC is
// required and who may call this (applyPartnerAssertedConsent only).
export async function upgradeToOptedInWithOrigin(
  args: UpgradeArgs,
  originIntegrationId: string
): Promise<boolean> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase.rpc('upgrade_consent_to_opted_in_with_origin', {
    p_restaurant_id: args.restaurantId,
    p_phone_e164: args.phoneE164,
    p_category: args.category,
    p_origin_integration_id: originIntegrationId,
  })
  if (error) throw new Error(`upgradeToOptedInWithOrigin: ${error.message}`)
  return ((data as number | null) ?? 0) > 0
}

interface RevokeArgs {
  restaurantId: string
  phoneE164: string
  category?: ConsentCategory
}

export async function revokeConsent(args: RevokeArgs): Promise<number> {
  const supabase = createServerSupabaseClient()
  const base = supabase
    .from('consent_records')
    .update({
      status: 'opted_out',
      revoked_at: new Date().toISOString(),
    })
    .eq('restaurant_id', args.restaurantId)
    .eq('phone_e164', args.phoneE164)
  const scoped = args.category ? base.eq('category', args.category) : base
  const { data, error } = await scoped
    .in('status', ACTIVE_STATUSES as unknown as string[])
    .select('id')
  if (error) throw new Error(`revokeConsent: ${error.message}`)
  return Array.isArray(data) ? data.length : 0
}

interface ApplyPartnerAssertedConsentArgs {
  restaurantId: string
  phoneE164: string
  memberId: string | null
  category: PartnerConsentCategory
  assertedLevel: ConsentLevel
  integrationId: string
  grade: ConsentGrade
  consentText: string | null
  businessNameShown: string | null
}

// INT-001 T-C1 / OD-13 / OD-14: the SOLE way the partner API path may write
// consent_records. `opted_out` is absorbing on every branch — this is the
// fix for STOP resurrection (see decidePartnerConsentAction's doc comment).
export async function applyPartnerAssertedConsent(
  args: ApplyPartnerAssertedConsentArgs
): Promise<PartnerConsentAction> {
  const latest = await findLatestConsentByCategory({
    restaurantId: args.restaurantId,
    phoneE164: args.phoneE164,
    category: args.category,
  })

  const action = decidePartnerConsentAction(
    latest?.snapshot.status ?? null,
    args.assertedLevel,
    args.category
  )

  if (action === 'blocked_opted_out' || action === 'noop') return action

  if (action === 'upgraded') {
    // WI-13 (Gap A): origin-attributed -- this whole function is the SOLE
    // partner-API write path (see its own header), so args.integrationId
    // is always the correct origin.
    const didUpgrade = await upgradeToOptedInWithOrigin(
      {
        restaurantId: args.restaurantId,
        phoneE164: args.phoneE164,
        category: args.category,
      },
      args.integrationId
    )
    // M-3: the RPC's own `WHERE status = 'pending'` guard is what makes
    // this safe under a STOP racing in between the read above and this
    // write -- but it also means the row count it returns is the ONLY
    // source of truth for whether anything actually changed.
    // `decidePartnerConsentAction` decided 'upgraded' from the (possibly
    // now-stale) read; if the RPC updated 0 rows, nothing was upgraded --
    // report `noop`, not a phantom upgrade on the job row's
    // `consent_actions`.
    return didUpgrade ? action : 'noop'
  }

  // action === 'inserted'
  const status = insertedRowStatus(args.assertedLevel, args.category)
  const shared = {
    id: randomUUID(),
    restaurantId: args.restaurantId,
    memberId: args.memberId,
    phoneE164: args.phoneE164,
    category: args.category,
    source: PARTNER_API_SOURCE,
    sourceReference: args.integrationId,
    businessNameShown: args.businessNameShown,
    consentTextShown: args.consentText,
  }
  const record =
    status === 'opted_in'
      ? ConsentRecord.grant({ ...shared, grade: args.grade })
      : ConsentRecord.markPending(shared)
  try {
    await insertConsentRecordWithOrigin(record, args.integrationId)
  } catch (err) {
    // I-3: two concurrent partner-API creates for the SAME (restaurant,
    // phone, category) can both read `latest = null` above and both decide
    // 'inserted'; the loser's insert 23505s here. That's benign -- the row
    // now exists, written by the winner -- not a real failure. Treat it as
    // `noop` rather than letting a PII-bearing ConsentImportError (even
    // last4-masked, it's still an exception on a path that should be
    // idempotent) propagate up through the job row / Slack / worker logs,
    // and rather than wasting a retry on an outcome that already happened.
    if (err instanceof ConsentImportError && err.reason === 'duplicate_active') {
      return 'noop'
    }
    throw err
  }
  return action
}

// Compile-time contract lock against the domain port — TS surfaces drift here.
export const consentRecordRepository: ConsentRecordRepository = {
  findActive: findActiveConsent,
  findActiveMarketingForPhones: findActiveMarketingConsentForPhones,
  insert: insertConsentRecord,
  revoke: revokeConsent,
  upgradeToOptedIn,
  findLatestByCategory: findLatestConsentByCategory,
  applyPartnerAssertedConsent,
}
