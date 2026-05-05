// INVARIANT (WAQ-004): SOLE writer to consent_records (service-role bypass;
// table has no INSERT/UPDATE policies). Route every mutation through here.

import { createServerSupabaseClient } from '../client'
import { ConsentRecord } from '@/domain/entities/consent-record'
import {
  ConsentImportError,
  type ConsentRecordRepository,
} from '@/domain/repositories/consent-record-repository'
import type { ConsentCategory } from '@/domain/value-objects/consent-status'
import {
  toEntity,
  toRow,
  type ConsentRecordRow,
} from './consent-record-mapper'

const ACTIVE_STATUSES = ['opted_in', 'pending'] as const

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
      `consent already exists for (${record.snapshot.restaurantId}, ${record.snapshot.phoneE164}, ${record.snapshot.category})`
    )
  }
  throw new Error(`insertConsentRecord: ${error.message}`)
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
  const { count, error } = await supabase
    .from('consent_records')
    .update({ status: 'opted_in', granted_at: new Date().toISOString() })
    .eq('restaurant_id', args.restaurantId)
    .eq('phone_e164', args.phoneE164)
    .eq('category', args.category)
    .eq('status', 'pending')
    .select('id', { count: 'exact' })
  if (error) throw new Error(`upgradeToOptedIn: ${error.message}`)
  return (count ?? 0) > 0
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

// Compile-time contract lock against the domain port — TS surfaces drift here.
export const consentRecordRepository: ConsentRecordRepository = {
  findActive: findActiveConsent,
  findActiveMarketingForPhones: findActiveMarketingConsentForPhones,
  insert: insertConsentRecord,
  revoke: revokeConsent,
  upgradeToOptedIn,
}
