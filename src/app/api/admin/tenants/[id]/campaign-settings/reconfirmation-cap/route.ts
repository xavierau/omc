// WONB-008 Stream C: platform-admin-only PATCH for the per-tenant
// reconfirmation daily cap (Q-I). DB has a CHECK BETWEEN 50 AND 100 — we
// validate at the API boundary too so a bad request returns 400 with a
// clear message instead of a generic 500.

import { NextRequest, NextResponse } from 'next/server'
import { assertPlatformAdmin } from '@/infrastructure/supabase/guards/platform-admin-guard'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'
import { checkAdminRateLimit } from '@/infrastructure/rate-limit/admin-rate-limit'
import { logAdminAction, extractIp } from '@/infrastructure/supabase/audit-logger'
import { setReconfirmationDailyCap } from '@/infrastructure/supabase/repositories/campaign-settings-repository'

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const CAP_MIN = 50
const CAP_MAX = 100

interface RouteParams {
  params: Promise<{ id: string }>
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const { userId } = await assertPlatformAdmin()
    if (!checkAdminRateLimit(userId).success) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }
    const { id } = await params
    if (!UUID_REGEX.test(id)) {
      return NextResponse.json({ error: 'Invalid tenant ID' }, { status: 400 })
    }
    const body = (await request.json()) as Record<string, unknown>
    const cap = parseCap(body.cap)
    if (cap === null) {
      return NextResponse.json(
        { error: `cap must be an integer between ${CAP_MIN} and ${CAP_MAX}` },
        { status: 400 }
      )
    }
    await setReconfirmationDailyCap(id, cap)
    logAdminAction({
      userId,
      action: 'reconfirmation.cap.update',
      resourceType: 'tenant_campaign_settings',
      resourceId: id,
      details: { restaurantId: id, cap },
      ipAddress: extractIp(request),
    })
    return NextResponse.json({ cap })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }
    console.error('Reconfirmation cap PATCH error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

function parseCap(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value)) return null
  if (value < CAP_MIN || value > CAP_MAX) return null
  return value
}
