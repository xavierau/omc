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
    await getTenantContext()
    const { id } = await params
    const campaign = await getCampaignById(id)

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
