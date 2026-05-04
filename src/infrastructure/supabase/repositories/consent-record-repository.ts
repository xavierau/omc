// INVARIANT (WAQ-004): the SOLE writer to the `consent_records` table.
// `createServerSupabaseClient()` uses SUPABASE_SERVICE_ROLE_KEY which
// bypasses RLS — there are no INSERT/UPDATE policies on the table by
// design. Do NOT add a browser-side write path; route every mutation
// through the named functions below so callers stay observable.

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

// Compile-time contract lock: this object MUST satisfy the domain repository
// interface. If a future edit drifts a function signature away from the port,
// TS surfaces it here rather than at the call sites or — worse — at runtime.
export const consentRecordRepository: ConsentRecordRepository = {
  findActive: findActiveConsent,
  insert: insertConsentRecord,
  revoke: revokeConsent,
}
