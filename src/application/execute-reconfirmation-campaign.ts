// WONB-008: orchestrator for reconfirmation-mode campaigns. Branches off
// the legacy `executeCampaign` path by audience query + send engine. Owns
// the eligibility re-check at execute-time so a campaign that passed
// preflight at creation but drifted out of GREEN-7d before launch is
// rejected here too.

import {
  updateCampaign,
  transitionCampaignStatus,
} from '@/infrastructure/supabase/repositories/campaign-repository'
import { claimReconfirmationAllotment } from '@/infrastructure/supabase/repositories/reconfirmation-cap-claim'
import { ReconfirmationEligibilityError } from '@/domain/services/__errors__/reconfirmation-errors'
import { checkReconfirmationEligibility } from './check-reconfirmation-eligibility'
import { resolveReconfirmationAudience } from './resolve-reconfirmation-audience'
import { executeReconfirmationBatch } from './execute-reconfirmation-batch'
import {
  loadUtilityTemplate,
  buildReconfirmationSendContext,
  audienceToMembers,
} from './execute-reconfirmation-campaign-helpers'
import { emitEvent } from './emit-event'
import type { Campaign } from '@/domain/entities/campaign'

interface ExecuteInput {
  campaign: Campaign
  restaurantId: string
}

export async function executeReconfirmationCampaign(
  input: ExecuteInput
): Promise<void> {
  const eligibility = await checkReconfirmationEligibility({
    restaurantId: input.restaurantId,
  })
  if (!eligibility.allowed) {
    throw new ReconfirmationEligibilityError(eligibility.violations)
  }
  const requestedCap = Math.max(
    0,
    eligibility.cap - eligibility.currentDailySent
  )
  // P0 fix (review finding 1): race-free claim via advisory lock so two
  // concurrent launches can't double-spend the daily cap. Returns 0 when
  // another launch is already mid-claim — we treat that as "skip cleanly".
  const remainingCap = await claimReconfirmationAllotment(
    input.restaurantId,
    requestedCap
  )
  const template = await loadUtilityTemplate(input.campaign)
  const audience = await resolveReconfirmationAudience({
    restaurantId: input.restaurantId,
    remainingCap,
  })

  const claimed = await transitionCampaignStatus(
    input.campaign.id,
    'active',
    'sending'
  )
  if (!claimed) {
    throw new Error(
      `Campaign ${input.campaign.id} not active or already processing`
    )
  }

  try {
    await emitLaunchEvent(input, audience.length)
    if (audience.length > 0) {
      const ctx = await buildReconfirmationSendContext({
        campaign: input.campaign,
        restaurantId: input.restaurantId,
        template,
      })
      await executeReconfirmationBatch({
        members: audienceToMembers(audience),
        ctx,
        dailyAllotment: remainingCap,
      })
    }
    await updateCampaign(input.campaign.id, { status: 'completed' })
  } catch (err) {
    // P1 fix (review finding 8): on send failure, transition to 'paused'
    // (not 'active') so the queue worker doesn't immediately re-trigger and
    // burn through retries / log spam in a tight loop. Persist the failure
    // context to console at error level for ops triage.
    await updateCampaign(input.campaign.id, { status: 'paused' })
    console.error('[reconfirmation] campaign send failed; paused for review', {
      campaignId: input.campaign.id,
      restaurantId: input.restaurantId,
      error: (err as Error)?.message,
      stack: (err as Error)?.stack,
      pausedAt: new Date().toISOString(),
    })
    throw err
  }
}

async function emitLaunchEvent(
  input: ExecuteInput,
  audienceCount: number
): Promise<void> {
  await emitEvent({
    restaurantId: input.restaurantId,
    memberId: null,
    type: 'campaign',
    dataJson: {
      mode: 'reconfirmation',
      audienceCount,
      campaignId: input.campaign.id,
    },
  })
}
