import { NextResponse } from 'next/server'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'
import { CampaignGuardrailError } from '@/application/campaign-guardrail-error'
import {
  WhatsAppTemplateNotFoundError,
  WhatsAppTemplateNotApprovedError,
} from '@/application/resolve-whatsapp-template'
import { TemplateHeaderMediaMissingError } from '@/application/enforce-header-media'
import { CampaignCouponConfigMissingError } from '@/application/enforce-coupon-params'

/** The one mapping of send-gate failures to HTTP, shared by /execute and /rerun. */
export function campaignSendErrorResponse(error: unknown, logLabel: string) {
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
  if (error instanceof CampaignCouponConfigMissingError) {
    return NextResponse.json({ error: error.message }, { status: 409 })
  }
  if (error instanceof AuthError) {
    return NextResponse.json({ error: error.message }, { status: error.statusCode })
  }
  console.error(`${logLabel}:`, error)
  return NextResponse.json({ error: 'Failed to queue campaign' }, { status: 500 })
}
