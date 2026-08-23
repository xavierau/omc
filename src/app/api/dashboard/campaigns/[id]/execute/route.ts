import { NextRequest, NextResponse } from 'next/server'
import { getCampaignById } from '@/infrastructure/supabase/repositories/campaign-repository'
import { addCampaignJob } from '@/infrastructure/queue/campaign-queue'
import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'
import { CampaignGuardrailError } from '@/application/campaign-guardrail-error'
import { resolveWhatsAppTemplate } from '@/application/resolve-whatsapp-template'
import { enforceTemplateReview } from '@/application/enforce-template-review'

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

    // Issue #102 Part A fix 2: run the WAQ-011 gate synchronously, BEFORE
    // enqueueing, so a blocked send returns 403 with the violation in the
    // response instead of `200 {"status":"queued"}` while the real failure
    // only ever surfaced in the worker log. Loads the same template the
    // worker would (resolveWhatsAppTemplate), so this can't drift from the
    // actual send-time check.
    const template = await resolveWhatsAppTemplate(campaign)
    await enforceTemplateReview({
      campaign,
      restaurantId: campaign.restaurantId,
      template,
    })

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
