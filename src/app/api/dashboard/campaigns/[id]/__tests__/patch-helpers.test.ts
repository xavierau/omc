import { describe, it, expect } from 'vitest'
import { applyFailureReasonRevivalGuard, validatePatchStatus } from '../patch-helpers'
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

// Review round 3 (#102 item 3): 'failed' is a SYSTEM-managed terminal
// status — only the queue worker (markCampaignFailed, on retry exhaustion)
// may set it, always paired with a failure_reason. A direct PATCH setting
// status='failed' would bypass that path and leave failureReason unset,
// breaking the "failed implies a reason" invariant the UI relies on.
describe('validatePatchStatus', () => {
  it("rejects a PATCH body setting status to 'failed'", () => {
    const error = validatePatchStatus({ status: 'failed' })
    expect(error).toEqual(expect.any(String))
    expect(error).toMatch(/failed/i)
  })

  it('allows every other status value', () => {
    for (const status of ['draft', 'active', 'sending', 'paused', 'completed']) {
      expect(validatePatchStatus({ status })).toBeNull()
    }
  })

  it('allows a patch that does not touch status at all', () => {
    expect(validatePatchStatus({ name: 'Renamed' })).toBeNull()
  })
})
