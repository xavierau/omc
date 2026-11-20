import { NextRequest, NextResponse } from 'next/server'
import { getCampaignByIdForRestaurant } from '@/infrastructure/supabase/repositories/campaign-repository'
import { addCampaignJob } from '@/infrastructure/queue/campaign-queue'
import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { enforceCampaignSendGates } from '@/application/enforce-campaign-send-gates'
import { campaignSendErrorResponse } from '../campaign-send-error-response'

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Review round 2, item 1: scoped query (SEC-001 pattern) — a
    // cross-tenant id resolves to null exactly like a missing one, never
    // fetch-then-compare-and-leak (the 403/409 bodies below carry that
    // tenant's guardrail/template state, so leaking the campaign itself
    // would leak that state too).
    const { restaurantId } = await getTenantContext()
    const { id } = await params
    const campaign = await getCampaignByIdForRestaurant(id, restaurantId)

    if (!campaign) {
      return NextResponse.json(
        { error: 'Campaign not found' },
        { status: 404 }
      )
    }
    if (campaign.status !== 'active') {
      return NextResponse.json(
        { error: 'Campaign must be active to execute' },
        { status: 400 }
      )
    }

    await enforceCampaignSendGates(campaign)

    await addCampaignJob({
      campaignId: campaign.id,
      restaurantId: campaign.restaurantId,
    })

    return NextResponse.json({ status: 'queued' })
  } catch (error) {
    return campaignSendErrorResponse(error, 'Campaign execute error')
  }
}
