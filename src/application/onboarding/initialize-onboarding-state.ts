// WONB-001: idempotent default-row creator. Returns the existing row if one
// exists, otherwise inserts a fresh default. The race-fallback handles the
// concurrent-insert window where both callers see findByRestaurantId=null.

import { TenantOnboardingState } from '@/domain/entities/onboarding/tenant-onboarding-state'
import type { TenantOnboardingStateRepository } from '@/domain/repositories/tenant-onboarding-state-repository'

export interface InitializeOnboardingStateArgs {
  restaurantId: string
  repo: TenantOnboardingStateRepository
}

export async function initializeOnboardingState(
  args: InitializeOnboardingStateArgs
): Promise<TenantOnboardingState> {
  const existing = await args.repo.findByRestaurantId(args.restaurantId)
  if (existing) return existing
  return tryInsertOrFallback(args)
}

async function tryInsertOrFallback(
  args: InitializeOnboardingStateArgs
): Promise<TenantOnboardingState> {
  const fresh = TenantOnboardingState.createDefault({
    id: crypto.randomUUID(),
    restaurantId: args.restaurantId,
    now: new Date().toISOString(),
  })
  try {
    await args.repo.insert(fresh)
    return fresh
  } catch (err) {
    const racer = await args.repo.findByRestaurantId(args.restaurantId)
    if (racer) return racer
    throw err
  }
}
