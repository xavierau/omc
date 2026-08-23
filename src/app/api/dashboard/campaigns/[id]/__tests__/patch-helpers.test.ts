import { describe, it, expect } from 'vitest'
import { applyFailureReasonRevivalGuard } from '../patch-helpers'
import type { UpdateCampaignParams } from '@/infrastructure/supabase/repositories/campaign-repository'

// Review round 2 (#102 item 4): failure_reason must be non-null ONLY when
// status='failed' (the entity invariant documented at campaign.ts). A PATCH
// that moves status away from 'failed' — most commonly reviving a campaign
// back to 'active' — must clear the stale reason.
describe('applyFailureReasonRevivalGuard', () => {
  it("clears failureReason when status is set to 'active' (revival)", () => {
    const changes: UpdateCampaignParams = { status: 'active' }
    applyFailureReasonRevivalGuard(changes)
    expect(changes.failureReason).toBeNull()
  })

  it.each(['draft', 'paused', 'completed', 'sending'] as const)(
    "clears failureReason for any status transition away from 'failed' (-> %s)",
    (status) => {
      const changes: UpdateCampaignParams = { status }
      applyFailureReasonRevivalGuard(changes)
      expect(changes.failureReason).toBeNull()
    }
  )

  it("does NOT touch failureReason when status is being set to 'failed'", () => {
    const changes: UpdateCampaignParams = { status: 'failed' }
    applyFailureReasonRevivalGuard(changes)
    expect('failureReason' in changes).toBe(false)
  })

  it('does not touch failureReason when status is not part of the patch', () => {
    const changes: UpdateCampaignParams = { name: 'Renamed' }
    applyFailureReasonRevivalGuard(changes)
    expect('failureReason' in changes).toBe(false)
  })
})
