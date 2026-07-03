// WAQ-012: GET /api/admin/quality — platform-admin overview of every
// tenant's quality rating + 7d KPIs. Mirrors the auth/rate-limit posture
// of /api/admin/template-reviews and /api/admin/tenants.

import { NextRequest, NextResponse } from 'next/server'
import { assertPlatformAdmin } from '@/infrastructure/supabase/guards/platform-admin-guard'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'
import { checkAdminRateLimit } from '@/infrastructure/rate-limit/admin-rate-limit'
import { getTenantQualityOverview } from '@/application/get-tenant-quality-overview'

const DEFAULT_WINDOW_DAYS = 7
// Upper bound prevents a malicious / accidentally-huge ?windowDays= from
// scanning years of whatsapp_messages on every poll. 90d covers any
// realistic dashboard range; longer windows go through analytics tooling.
const MAX_WINDOW_DAYS = 90
const VALID_RATINGS = ['GREEN', 'YELLOW', 'RED'] as const
type FilterRating = (typeof VALID_RATINGS)[number]

function parseWindowDays(raw: string | null): number {
  if (!raw) return DEFAULT_WINDOW_DAYS
  const n = parseInt(raw, 10)
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_WINDOW_DAYS
  return Math.min(n, MAX_WINDOW_DAYS)
}

function parseFilterRating(
  raw: string | null
): { ok: true; value: FilterRating | undefined } | { ok: false } {
  if (!raw) return { ok: true, value: undefined }
  if ((VALID_RATINGS as readonly string[]).includes(raw)) {
    return { ok: true, value: raw as FilterRating }
  }
  return { ok: false }
}

async function buildOverviewResponse(
  request: NextRequest
): Promise<NextResponse> {
  const { userId } = await assertPlatformAdmin()
  if (!checkAdminRateLimit(userId).success) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }
  const { searchParams } = request.nextUrl
  const filter = parseFilterRating(searchParams.get('filterRating'))
  if (!filter.ok) {
    return NextResponse.json({ error: 'Invalid filterRating' }, { status: 400 })
  }
  const windowDays = parseWindowDays(searchParams.get('windowDays'))
  const rows = await getTenantQualityOverview({
    windowDays,
    filterRating: filter.value,
  })
  return NextResponse.json({ rows, windowDays })
}

export async function GET(request: NextRequest) {
  try {
    return await buildOverviewResponse(request)
  } catch (error) {
    return handleError(error, 'Quality overview error')
  }
}

function handleError(error: unknown, label: string) {
  if (error instanceof AuthError) {
    return NextResponse.json(
      { error: error.message },
      { status: error.statusCode }
    )
  }
  console.error(`${label}:`, error)
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
}
