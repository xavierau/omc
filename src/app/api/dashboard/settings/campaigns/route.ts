/**
 * CAMP-016: the tenant's campaign audience defaults (skip low-quality
 * contacts, lapsed after N days) for Settings → Campaigns and the campaign
 * form's pre-fill. GET: any tenant member. PUT: tenant admin only (R1),
 * mirroring settings/booking. The restaurant id comes from the session,
 * never the body; values are re-validated here (R4).
 */
import { NextRequest, NextResponse } from 'next/server'
import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { isTenantAdmin, requireTenantAdmin } from '@/infrastructure/supabase/guards/require-tenant-admin'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'
import {
  getAudienceDefaults,
  saveAudienceDefaults,
} from '@/infrastructure/supabase/repositories/campaign-audience-defaults-repository'
import {
  parseLapsedDays,
  parseSkipContactQuality,
  type CampaignAudienceDefaults,
} from '@/domain/value-objects/audience-filters'
import {
  CONTACT_QUALITY_THRESHOLDS,
  CONTACT_QUALITY_WINDOW_DAYS,
} from '@/domain/value-objects/contact-quality'

const THRESHOLDS = {
  greenPercent: Math.round(CONTACT_QUALITY_THRESHOLDS.green * 100),
  yellowPercent: Math.round(CONTACT_QUALITY_THRESHOLDS.yellow * 100),
  windowDays: CONTACT_QUALITY_WINDOW_DAYS,
}

function authError(error: unknown) {
  return error instanceof AuthError
    ? NextResponse.json({ error: error.message }, { status: error.statusCode })
    : null
}

export async function GET() {
  try {
    const ctx = await getTenantContext()
    const defaults = await getAudienceDefaults(ctx.restaurantId)
    return NextResponse.json({ ...defaults, thresholds: THRESHOLDS, canEdit: isTenantAdmin(ctx) })
  } catch (error) {
    const denied = authError(error)
    if (denied) return denied
    console.error('[CampaignSettings] read failed:', (error as Error).message)
    return NextResponse.json({ error: 'Failed to load campaign settings' }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  try {
    const ctx = await getTenantContext()
    requireTenantAdmin(ctx)
    const body = await request.json().catch(() => null)
    const parsed = parseBody(body)
    if ('fields' in parsed) {
      return NextResponse.json({ error: 'invalid', fields: parsed.fields }, { status: 400 })
    }
    const saved = await saveAudienceDefaults(ctx.restaurantId, parsed)
    return NextResponse.json({ success: true, ...saved })
  } catch (error) {
    const denied = authError(error)
    if (denied) return denied
    console.error('[CampaignSettings] update failed:', (error as Error).message)
    return NextResponse.json({ error: 'Failed to update campaign settings' }, { status: 500 })
  }
}

function parseBody(body: unknown): CampaignAudienceDefaults | { fields: string[] } {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  const skipContactQuality = parseSkipContactQuality(b.skipContactQuality)
  const lapsedAfterDays = parseLapsedDays(b.lapsedAfterDays)
  const fields = [
    ...(skipContactQuality ? [] : ['skipContactQuality']),
    ...(lapsedAfterDays === null ? ['lapsedAfterDays'] : []),
  ]
  if (fields.length > 0 || !skipContactQuality || lapsedAfterDays === null) return { fields }
  return { skipContactQuality, lapsedAfterDays }
}
