// WONB-001: assign the onboarding path while phase=setup. The entity raises
// OnboardingPathLockedError before the row is even loaded if it has advanced
// past `setup`. We also guard the WRITE with optimistic concurrency
// (expectedPhase='setup') to catch the race where an `advance` lands between
// our find and update — surfacing that as OnboardingPathLockedError because
// the user-visible meaning is "phase moved, you can't change path anymore".

import { TenantOnboardingState } from '@/domain/entities/onboarding/tenant-onboarding-state'
import {
  ConcurrentAdvanceError,
  OnboardingPathLockedError,
} from '@/domain/services/__errors__/onboarding-errors'
import type { OnboardingPath } from '@/domain/value-objects/onboarding-path'
import type { TenantOnboardingStateRepository } from '@/domain/repositories/tenant-onboarding-state-repository'

export interface SetOnboardingPathArgs {
  restaurantId: string
  path: OnboardingPath
  repo: TenantOnboardingStateRepository
}

export async function setOnboardingPath(
  args: SetOnboardingPathArgs
): Promise<TenantOnboardingState> {
  const current = await args.repo.findByRestaurantId(args.restaurantId)
  if (!current) {
    throw new Error(
      `setOnboardingPath: state not found for restaurant ${args.restaurantId}`
    )
  }
  const next = current.setPath(args.path, new Date().toISOString())
  try {
    await args.repo.update(next, 'setup')
  } catch (err) {
    if (err instanceof ConcurrentAdvanceError) throw new OnboardingPathLockedError()
    throw err
  }
  return next
}
