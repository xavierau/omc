import { NextRequest, NextResponse } from 'next/server'
import {
  getCampaignByIdForRestaurant,
  reviveFailedCampaign,
} from '@/infrastructure/supabase/repositories/campaign-repository'
import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { enforceCampaignSendGates } from '@/application/enforce-campaign-send-gates'
import { enqueueRevivedCampaign } from '@/application/enqueue-revived-campaign'
import {
  findRerunEvidenceRefusal,
  type RerunEvidenceRefusal,
} from '@/application/rerun-evidence-guard'
import { rerunBlock, type RerunBlock } from '@/domain/services/campaign-rerun'
import { campaignSendErrorResponse } from '../campaign-send-error-response'

const REFUSALS: Record<RerunBlock | RerunEvidenceRefusal, { error: string; status: number }> = {
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
  no_service_window: {
    error:
      "This campaign's template cannot reach customers outside the 24-hour window. Create a new campaign with a quick-reply (claim) template.",
    status: 409,
  },
  delivery_unconfirmed: {
    error:
      'OhMyClient cannot confirm delivery of this campaign, so a re-run could message customers twice. Contact support.',
    status: 409,
  },
  coupons_expired: {
    error: "This campaign's coupons have expired. Create a new campaign.",
    status: 409,
  },
}

// CAMP-014: order is the guarantee. The row evidence comes first, then the gates,
// so a refused or blocked re-run leaves the campaign failed with its reason. The
// failed -> active CAS then admits one request, so a double click cannot enqueue
// twice. enqueueRevivedCampaign covers the lease, and undoes the CAS if it fails.
// The worker's active -> sending CAS stays the run-level guard, and its per-member
// ledger skips counted sends.
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
    const refusal = await findRerunEvidenceRefusal(campaign)
    if (refusal) {
      const { error, status } = REFUSALS[refusal]
      return NextResponse.json({ error }, { status })
    }

    await enforceCampaignSendGates(campaign)

    if (!(await reviveFailedCampaign(campaign.id, restaurantId))) {
      return NextResponse.json(
        { error: 'This campaign is already being re-run' },
        { status: 409 }
      )
    }
    await enqueueRevivedCampaign(campaign)
    return NextResponse.json({ status: 'queued' })
  } catch (error) {
    return campaignSendErrorResponse(error, 'Campaign rerun error')
  }
}
