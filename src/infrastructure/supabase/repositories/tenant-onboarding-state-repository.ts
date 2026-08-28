// INVARIANT (WONB-001): SOLE writer to `tenant_onboarding_state`.
// `createServerSupabaseClient()` uses SUPABASE_SERVICE_ROLE_KEY which
// bypasses RLS — the table has no INSERT/UPDATE policies by design. Do not
// add a browser-side write path; route every mutation through the named
// functions below so callers stay observable.

import { createServerSupabaseClient } from '../client'
import { TenantOnboardingState } from '@/domain/entities/onboarding/tenant-onboarding-state'
import { ConcurrentAdvanceError } from '@/domain/services/__errors__/onboarding-errors'
import type { TenantOnboardingStateRepository } from '@/domain/repositories/tenant-onboarding-state-repository'
import type { OnboardingPhase } from '@/domain/value-objects/onboarding-phase'
import {
  toEntity,
  toInsertRow,
  toUpdateRow,
  type TenantOnboardingStateRow,
} from './tenant-onboarding-state-mapper'

const TABLE = 'tenant_onboarding_state'

export async function findByRestaurantId(
  restaurantId: string
): Promise<TenantOnboardingState | null> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .eq('restaurant_id', restaurantId)
    .maybeSingle()
  if (error) throw new Error(`findByRestaurantId: ${error.message}`)
  if (!data) return null
  return toEntity(data as TenantOnboardingStateRow)
}

export async function insert(state: TenantOnboardingState): Promise<void> {
  const supabase = createServerSupabaseClient()
  const { error } = await supabase.from(TABLE).insert(toInsertRow(state))
  if (error) throw new Error(`insert: ${error.message}`)
}

export async function update(
  state: TenantOnboardingState,
  expectedPhase: OnboardingPhase
): Promise<void> {
  // Optimistic concurrency. Match on (id, phase=expectedPhase) so a setPath
  // or checklist write loses the race when an `advance` already moved the
  // row's phase. Same `count: 'exact'` strategy as `advance` below.
  const supabase = createServerSupabaseClient()
  const { error, count } = await supabase
    .from(TABLE)
    .update(toUpdateRow(state), { count: 'exact' })
    .eq('id', state.snapshot.id)
    .eq('phase', expectedPhase)
  if (error) throw new Error(`update: ${error.message}`)
  if ((count ?? 0) === 0) throw new ConcurrentAdvanceError()
}

export async function advance(
  state: TenantOnboardingState,
  expectedFrom: OnboardingPhase
): Promise<TenantOnboardingState> {
  // Optimistic concurrency. Postgres applies UPDATE's WHERE before SET, so
  // matching on `phase = $expectedFrom` filters the row in its prior state
  // before writing the new phase. `count: 'exact'` lets us tell a 0-row
  // match (someone else advanced first) from a successful single-row update
  // without a follow-up SELECT.
  const supabase = createServerSupabaseClient()
  const { error, count } = await supabase
    .from(TABLE)
    .update(toUpdateRow(state), { count: 'exact' })
    .eq('id', state.snapshot.id)
    .eq('phase', expectedFrom)
  if (error) throw new Error(`advance: ${error.message}`)
  if ((count ?? 0) === 0) throw new ConcurrentAdvanceError()
  return state
}

export const tenantOnboardingStateRepository: TenantOnboardingStateRepository = {
  findByRestaurantId,
  insert,
  update,
  advance,
}
