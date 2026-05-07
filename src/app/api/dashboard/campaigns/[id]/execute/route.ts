import { NextRequest, NextResponse } from 'next/server'
import { getCampaignById } from '@/infrastructure/supabase/repositories/campaign-repository'
import { addCampaignJob } from '@/infrastructure/queue/campaign-queue'
import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'
import { CampaignGuardrailError } from '@/application/campaign-guardrail-error'

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { restaurantId: callerRestaurantId } = await getTenantContext()
    const { id } = await params
    const campaign = await getCampaignById(id)

    // P0 fix (review finding 3): pre-existing IDOR — getTenantContext was
    // awaited but its restaurantId was discarded, so Tenant A could trigger
    // Tenant B's campaign. We collapse "not found" and "cross-tenant" to the
    // same 404 response so the API can't be used to enumerate campaign IDs.
    if (!campaign || campaign.restaurantId !== callerRestaurantId) {
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

    await addCampaignJob({
      campaignId: campaign.id,
      restaurantId: campaign.restaurantId,
    })

    return NextResponse.json({ status: 'queued' })
  } catch (error) {
    if (error instanceof CampaignGuardrailError) {
      return NextResponse.json(
        { error: 'Campaign blocked by guardrails', violations: error.violations },
        { status: 403 }
      )
    }
    if (error instanceof AuthError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.statusCode }
      )
    }
    console.error('Campaign execute error:', error)
    return NextResponse.json(
      { error: 'Failed to queue campaign' },
      { status: 500 }
    )
  }
}
