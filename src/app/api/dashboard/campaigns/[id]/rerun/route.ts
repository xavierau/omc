import { NextRequest, NextResponse } from 'next/server'
import {
  claimCampaignForEnqueue,
  getCampaignByIdForRestaurant,
  reviveFailedCampaign,
} from '@/infrastructure/supabase/repositories/campaign-repository'
import { addCampaignJob } from '@/infrastructure/queue/campaign-queue'
import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { enforceCampaignSendGates } from '@/application/enforce-campaign-send-gates'
import { rerunBlock, type RerunBlock } from '@/domain/services/campaign-rerun'
import { campaignSendErrorResponse } from '../campaign-send-error-response'

const REFUSALS: Record<RerunBlock, { error: string; status: number }> = {
  welcome: {
    error: 'Welcome campaigns are sent when a member joins and cannot be re-run',
    status: 400,
  },
  not_failed: { error: 'Only a failed campaign can be re-run', status: 400 },
  delivery_unknown: {
    error:
      'Delivery of this campaign could not be confirmed, so a re-run could message customers twice. Contact support.',
    status: 409,
  },
}

// CAMP-014: order is the guarantee. Gates first, so a blocked re-run leaves the
// campaign failed with its reason. The failed -> active CAS then admits one
// request, so a double click cannot enqueue twice. The lease covers the cron,
// which sees a revived campaign with a past scheduled_at as due: a lost lease
// means a job is already on its way. The worker's active -> sending CAS stays
// the run-level guard, and its per-member ledger skips counted sends.
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { restaurantId } = await getTenantContext()
    const { id } = await params
    const campaign = await getCampaignByIdForRestaurant(id, restaurantId)
    if (!campaign) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
    }

    const block = rerunBlock(campaign)
    if (block) {
      const { error, status } = REFUSALS[block]
      return NextResponse.json({ error }, { status })
    }

    await enforceCampaignSendGates(campaign)

    if (!(await reviveFailedCampaign(campaign.id, restaurantId))) {
      return NextResponse.json(
        { error: 'This campaign is already being re-run' },
        { status: 409 }
      )
    }
    if (await claimCampaignForEnqueue(campaign.id)) {
      await addCampaignJob({ campaignId: campaign.id, restaurantId })
    }
    return NextResponse.json({ status: 'queued' })
  } catch (error) {
    return campaignSendErrorResponse(error, 'Campaign rerun error')
  }
}
