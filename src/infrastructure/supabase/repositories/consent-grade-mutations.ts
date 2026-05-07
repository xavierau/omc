// Grade-mutation writers for consent_records. Extracted from
// `consent-record-repository.ts` so the origin file stays under the file-size
// limit. Re-exported from there so callers keep their import path stable.
//
// INVARIANT (WAQ-004): same writer guarantee as the origin file — service-role
// only; the table has no INSERT/UPDATE policies, so route every mutation
// through these helpers.

import { createServerSupabaseClient } from '../client'
import type {
  ConsentCategory,
  ConsentGrade,
  ConsentStatus,
} from '@/domain/value-objects/consent-status'

export interface UpgradeToOptedInArgs {
  restaurantId: string
  phoneE164: string
  category: ConsentCategory
}

// WONB-005: idempotent pending→opted_in flip. Stamps `granted_at` (explicit
// grant moment for WONB-007/008 analytics). True iff a pending row was upgraded.
export async function upgradeToOptedIn(
  args: UpgradeToOptedInArgs
): Promise<boolean> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from('consent_records')
    .update({ status: 'opted_in', granted_at: new Date().toISOString() })
    .eq('restaurant_id', args.restaurantId)
    .eq('phone_e164', args.phoneE164)
    .eq('category', args.category)
    .eq('status', 'pending')
    .select('id')
  if (error) throw new Error(`upgradeToOptedIn: ${error.message}`)
  return (data?.length ?? 0) > 0
}

export interface UpgradeGradeToStrongArgs {
  restaurantId: string
  phoneE164: string
  category: ConsentCategory
}

// WONB-008: idempotent weak+opted_in → strong+opted_in flip. Stamps
// `granted_at` (explicit grant moment for events.consent_granted analytics).
// True iff a weak+opted_in row was upgraded; false on already-strong,
// weak+pending, or no-row. Never throws on missing rows.
export async function upgradeGradeToStrong(
  args: UpgradeGradeToStrongArgs
): Promise<boolean> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from('consent_records')
    .update({ consent_grade: 'strong', granted_at: new Date().toISOString() })
    .eq('restaurant_id', args.restaurantId)
    .eq('phone_e164', args.phoneE164)
    .eq('category', args.category)
    .eq('status', 'opted_in')
    .eq('consent_grade', 'weak')
    .select('id')
  if (error) throw new Error(`upgradeGradeToStrong: ${error.message}`)
  return (data?.length ?? 0) > 0
}

interface CountByGradeStatusArgs {
  restaurantId: string
  grade: ConsentGrade
  status: ConsentStatus
  category: ConsentCategory
}

// WONB-008: single COUNT query — used by the reconfirmation pre-flight to
// size the audience (`grade='weak' AND status='opted_in'`). `head: true`
// keeps the response count-only — no rows shipped over the wire.
export async function countByGradeStatus(
  args: CountByGradeStatusArgs
): Promise<number> {
  const supabase = createServerSupabaseClient()
  const { count, error } = await supabase
    .from('consent_records')
    .select('id', { count: 'exact', head: true })
    .eq('restaurant_id', args.restaurantId)
    .eq('category', args.category)
    .eq('status', args.status)
    .eq('consent_grade', args.grade)
  if (error) throw new Error(`countByGradeStatus: ${error.message}`)
  return count ?? 0
}
