import type { Campaign } from '@/domain/entities/campaign'
import {
  claimCampaignForEnqueue,
  restoreCampaignFailure,
  stampCampaignEnqueued,
} from '@/infrastructure/supabase/repositories/campaign-repository'
import { addCampaignJob } from '@/infrastructure/queue/campaign-queue'

/**
 * CAMP-014: enqueue a campaign /rerun just revived. `campaign` is the row as read
 * before the revive, so it still holds the failure reason. On any error the revive
 * is undone before rethrowing: a re-run answered as failed must not send later
 * from the cron, which would see a past scheduled_at as due.
 */
export async function enqueueRevivedCampaign(campaign: Campaign): Promise<void> {
  try {
    await leaseAndEnqueue(campaign)
  } catch (error) {
    await revertRevive(campaign)
    throw error
  }
}

// A lost lease means different things by schedule. Scheduled: the cron enqueues
// once the lease lapses, so a job here would only race it. Unscheduled: no cron
// ever selects it, so it stamps and enqueues itself, and the worker's
// active -> sending CAS stays the run-level guard against a second job.
async function leaseAndEnqueue(campaign: Campaign): Promise<void> {
  const leased = await claimCampaignForEnqueue(campaign.id)
  if (!leased) {
    if (campaign.scheduledAt !== null) return
    await stampCampaignEnqueued(campaign.id, campaign.restaurantId)
  }
  await addCampaignJob({ campaignId: campaign.id, restaurantId: campaign.restaurantId })
}

async function revertRevive(campaign: Campaign): Promise<void> {
  const context = { campaignId: campaign.id }
  try {
    const restored = await restoreCampaignFailure(
      campaign.id,
      campaign.restaurantId,
      campaign.failureReason
    )
    if (!restored) console.error('[CampaignRerun] revert matched no active row', context)
  } catch (error) {
    console.error('[CampaignRerun] revert to failed did not apply', { ...context, error })
  }
}
