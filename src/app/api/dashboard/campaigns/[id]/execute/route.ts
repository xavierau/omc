import { NextRequest, NextResponse } from 'next/server'
import { getCampaignByIdForRestaurant } from '@/infrastructure/supabase/repositories/campaign-repository'
import { addCampaignJob } from '@/infrastructure/queue/campaign-queue'
import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'
import { CampaignGuardrailError } from '@/application/campaign-guardrail-error'
import {
  resolveWhatsAppTemplate,
  WhatsAppTemplateNotFoundError,
  WhatsAppTemplateNotApprovedError,
} from '@/application/resolve-whatsapp-template'
import { enforceTemplateReview } from '@/application/enforce-template-review'
import {
  enforceHeaderMedia,
  TemplateHeaderMediaMissingError,
} from '@/application/enforce-header-media'
import { enforceCampaignGuardrails } from '@/application/enforce-campaign-guardrails'

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

    // Issue #102 Part A fix 2 + review round 2 item 2: run every send-time
    // gate synchronously, BEFORE enqueueing, in the SAME order executeCampaign
    // does, so a blocked send returns a typed 4xx with the real reason
    // instead of `200 {"status":"queued"}` — previously the real failure
    // only surfaced in the worker log, or (for a TRANSIENT violation like a
    // tenant pause) burned 3 blind retries and permanently failed the
    // campaign. targetMemberCount=0 mirrors the cron's documented
    // optimistic check (see /api/cron/campaigns/route.ts) — the real
    // member count isn't known pre-enqueue, but this still catches pause,
    // daily-limit, and unsubscribe-rate violations immediately.
    await enforceCampaignGuardrails(campaign.restaurantId, 0)

    // Item 3: loads the same template the worker would, so this can't
    // drift from the actual send-time check.
    const template = await resolveWhatsAppTemplate(campaign)
    await enforceTemplateReview({
      campaign,
      restaurantId: campaign.restaurantId,
      template,
    })
    // #127 / CAMP-007: same order as executeCampaign — a media-header
    // template with no usable stored URL fails every send with #132012.
    enforceHeaderMedia(template)

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
    // Item 3: a user-caused state (misconfigured campaign) must explain
    // itself — map to a typed status with the actual message instead of
    // falling through to the generic 500 below.
    if (error instanceof WhatsAppTemplateNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    if (error instanceof WhatsAppTemplateNotApprovedError) {
      return NextResponse.json({ error: error.message }, { status: 409 })
    }
    // #127 / CAMP-007: same class of problem as not-approved — the template
    // is in a state that cannot send — so the same 409 contract.
    if (error instanceof TemplateHeaderMediaMissingError) {
      return NextResponse.json({ error: error.message }, { status: 409 })
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
