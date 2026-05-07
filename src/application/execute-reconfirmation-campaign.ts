// WONB-008: orchestrator for reconfirmation-mode campaigns. Branches off
// the legacy `executeCampaign` path by audience query + send engine. Owns
// the eligibility re-check at execute-time so a campaign that passed
// preflight at creation but drifted out of GREEN-7d before launch is
// rejected here too.

import {
  updateCampaign,
  transitionCampaignStatus,
} from '@/infrastructure/supabase/repositories/campaign-repository'
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
  const remainingCap = Math.max(
    0,
    eligibility.cap - eligibility.currentDailySent
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
        members: audienceToMembers(audience, input.restaurantId),
        ctx,
        dailyAllotment: remainingCap,
      })
    }
    await updateCampaign(input.campaign.id, { status: 'completed' })
  } catch (err) {
    await updateCampaign(input.campaign.id, { status: 'active' })
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
