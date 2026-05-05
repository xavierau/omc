// WONB-001: tick / untick a single checklist item. The entity treats ticks
// on N/A items (e.g., hk_sim_never_used under path B*) as no-ops; we still
// call repo.update so the route returns a consistent view even on no-ops.
// The write uses optimistic concurrency on the snapshot's current phase so
// a tick that races with an `advance` raises ConcurrentAdvanceError (→ 409)
// rather than silently overwriting the advanced row's checklist.

import { TenantOnboardingState } from '@/domain/entities/onboarding/tenant-onboarding-state'
import type { ChecklistKey } from '@/domain/value-objects/pre-kickoff-checklist'
import type { TenantOnboardingStateRepository } from '@/domain/repositories/tenant-onboarding-state-repository'

export interface UpdateChecklistItemArgs {
  restaurantId: string
  key: ChecklistKey
  checked: boolean
  actor: string
  repo: TenantOnboardingStateRepository
}

export async function updateChecklistItem(
  args: UpdateChecklistItemArgs
): Promise<TenantOnboardingState> {
  const current = await args.repo.findByRestaurantId(args.restaurantId)
  if (!current) {
    throw new Error(
      `updateChecklistItem: state not found for restaurant ${args.restaurantId}`
    )
  }
  const now = new Date().toISOString()
  const next = args.checked
    ? current.tickChecklist(args.key, args.actor, now)
    : current.untickChecklist(args.key, now)
  await args.repo.update(next, current.snapshot.phase)
  return next
}
