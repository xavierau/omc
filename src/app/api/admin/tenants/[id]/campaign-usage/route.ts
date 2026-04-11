import { NextRequest, NextResponse } from 'next/server'
import { assertPlatformAdmin } from '@/infrastructure/supabase/guards/platform-admin-guard'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'
import { checkAdminRateLimit } from '@/infrastructure/rate-limit/admin-rate-limit'
import { getCampaignUsage } from '@/application/get-campaign-usage'

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MONTH_REGEX = /^\d{4}-\d{2}$/

interface RouteParams {
  params: Promise<{ id: string }>
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { userId } = await assertPlatformAdmin()
    if (!checkAdminRateLimit(userId).success) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }

    const { id } = await params
    if (!UUID_REGEX.test(id)) {
      return NextResponse.json({ error: 'Invalid tenant ID' }, { status: 400 })
    }

    const month = extractMonth(request)
    if (month !== undefined && !MONTH_REGEX.test(month)) {
      return NextResponse.json(
        { error: 'Invalid month format. Use YYYY-MM' },
        { status: 400 }
      )
    }

    const usage = await getCampaignUsage(id, month)

    return NextResponse.json({
      month: usage.month,
      totalSent: usage.totalSent,
      totalEstimatedCost: usage.totalEstimatedCost,
      campaigns: usage.campaigns,
    })
  } catch (error) {
    return handleError(error)
  }
}

function extractMonth(request: NextRequest): string | undefined {
  const { searchParams } = new URL(request.url)
  return searchParams.get('month') ?? undefined
}

function handleError(error: unknown) {
  if (error instanceof AuthError) {
    return NextResponse.json({ error: error.message }, { status: error.statusCode })
  }
  console.error('Campaign usage GET error:', error)
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
}
