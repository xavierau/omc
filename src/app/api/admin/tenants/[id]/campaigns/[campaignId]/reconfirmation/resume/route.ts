// WONB-008 Stream C: platform-admin-only resume for an auto-paused
// reconfirmation campaign (Q-H2). Tenant-manager cannot resume — that's the
// whole point of the gate. Re-runs the full eligibility check (NOT just
// GREEN-7d) so a tenant that recovered quality but hit the daily cap meanwhile
// is still blocked.
//
// Side-effect note (review finding 7):
//   `clearAutoQualityFlags(tenantId)` writes `auto_pause_active=false` on the
//   tenant's single `tenant_campaign_settings` row. There is no per-mode
//   auto-pause flag — the YELLOW→auto-pause transition pauses the WHOLE
//   tenant (all modes), and recovery clears the WHOLE tenant. This is the
//   correct architectural behavior: a tenant that recovered quality should
//   have all of its auto-paused marketing campaigns un-throttled in lockstep.
//   We surface the side-effect to the admin via `sideEffectsNote` in the
//   response so the dashboard can render an "FYI marketing campaigns also
//   resumed" toast — there is no per-mode mechanism to scope this clear.

import { NextRequest, NextResponse } from 'next/server'
import { assertPlatformAdmin } from '@/infrastructure/supabase/guards/platform-admin-guard'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'
import { checkAdminRateLimit } from '@/infrastructure/rate-limit/admin-rate-limit'
import { logAdminAction, extractIp } from '@/infrastructure/supabase/audit-logger'
import {
  getCampaignById,
  transitionCampaignStatus,
} from '@/infrastructure/supabase/repositories/campaign-repository'
import { getSettingsForTenant } from '@/infrastructure/supabase/repositories/campaign-settings-repository'
import { clearAutoQualityFlags } from '@/infrastructure/supabase/repositories/quality-auto-flags'
import { checkReconfirmationEligibility } from '@/application/check-reconfirmation-eligibility'

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface RouteParams {
  params: Promise<{ id: string; campaignId: string }>
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { userId } = await assertPlatformAdmin()
    if (!checkAdminRateLimit(userId).success) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }
    const { id, campaignId } = await params
    const idError = validateIds(id, campaignId)
    if (idError) return idError

    const checks = await runResumeChecks(id, campaignId)
    if (checks instanceof NextResponse) return checks

    await clearAutoQualityFlags(id)
    // Atomic status flip: paused → active. Defends against double-resume
    // (the second concurrent caller updates 0 rows).
    const flipped = await transitionCampaignStatus(campaignId, 'paused', 'active')
    if (!flipped) {
      return NextResponse.json(
        { error: 'Campaign is not paused', reason: 'CAMPAIGN_NOT_PAUSED' },
        { status: 409 }
      )
    }
    const restartedAt = new Date().toISOString()
    logResumeAudit(userId, id, campaignId, request, restartedAt)
    return NextResponse.json({
      resumed: true,
      restartedAt,
      sideEffectsNote:
        'Auto-paused marketing campaigns for this tenant also resumed (auto-pause flag is tenant-wide, not per-mode).',
    })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }
    console.error('Reconfirmation resume error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

function validateIds(tenantId: string, campaignId: string): NextResponse | null {
  if (!UUID_REGEX.test(tenantId)) {
    return NextResponse.json({ error: 'Invalid tenant ID' }, { status: 400 })
  }
  if (!UUID_REGEX.test(campaignId)) {
    return NextResponse.json({ error: 'Invalid campaign ID' }, { status: 400 })
  }
  return null
}

async function runResumeChecks(
  tenantId: string,
  campaignId: string
): Promise<NextResponse | null> {
  const campaign = await getCampaignById(campaignId)
  if (!campaign || campaign.restaurantId !== tenantId || campaign.mode !== 'reconfirmation') {
    return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
  }
  if (campaign.status !== 'paused') {
    return NextResponse.json(
      { error: 'Campaign is not paused', reason: 'CAMPAIGN_NOT_PAUSED' },
      { status: 409 }
    )
  }
  const settings = await getSettingsForTenant(tenantId)
  if (!settings?.autoPauseActive) {
    return NextResponse.json(
      { error: 'Tenant is not currently auto-paused', reason: 'not_auto_paused' },
      { status: 400 }
    )
  }
  const eligibility = await checkReconfirmationEligibility({ restaurantId: tenantId })
  if (!eligibility.allowed) {
    return NextResponse.json(
      {
        error: 'Reconfirmation eligibility re-check failed',
        reason: 'reconfirmation_not_allowed',
        violations: eligibility.violations,
      },
      { status: 400 }
    )
  }
  return null
}

function logResumeAudit(
  userId: string,
  tenantId: string,
  campaignId: string,
  request: Request,
  restartedAt: string
): void {
  logAdminAction({
    userId,
    action: 'reconfirmation.resume',
    resourceType: 'campaign',
    resourceId: campaignId,
    details: { restaurantId: tenantId, restartedAt },
    ipAddress: extractIp(request),
  })
}
