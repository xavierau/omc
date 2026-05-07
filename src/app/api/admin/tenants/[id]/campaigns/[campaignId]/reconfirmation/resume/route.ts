// WONB-008 Stream C: platform-admin-only resume for an auto-paused
// reconfirmation campaign (Q-H2). Tenant-manager cannot resume — that's the
// whole point of the gate. Re-runs the full eligibility check (NOT just
// GREEN-7d) so a tenant that recovered quality but hit the daily cap meanwhile
// is still blocked.

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
    return NextResponse.json({ resumed: true, restartedAt })
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
