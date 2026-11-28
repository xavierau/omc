import { NextRequest, NextResponse } from 'next/server'
import { assertPlatformAdmin } from '@/infrastructure/supabase/guards/platform-admin-guard'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'
import { checkAdminRateLimit } from '@/infrastructure/rate-limit/admin-rate-limit'
import { getBillingReport } from '@/application/get-billing-report'

const MONTH_REGEX = /^\d{4}-\d{2}$/

export async function GET(request: NextRequest) {
  try {
    const { userId } = await assertPlatformAdmin()
    if (!checkAdminRateLimit(userId).success) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }

    const month = extractMonth(request)
    if (month !== undefined && !isValidMonth(month)) {
      return NextResponse.json(
        { error: 'Invalid month format. Use YYYY-MM (01-12)' },
        { status: 400 }
      )
    }

    const report = await getBillingReport(month)
    return NextResponse.json(report)
  } catch (error) {
    return handleError(error)
  }
}

function extractMonth(request: NextRequest): string | undefined {
  const { searchParams } = new URL(request.url)
  return searchParams.get('month') ?? undefined
}

function isValidMonth(month: string): boolean {
  if (!MONTH_REGEX.test(month)) return false
  const m = Number(month.split('-')[1])
  return m >= 1 && m <= 12
}

function handleError(error: unknown) {
  if (error instanceof AuthError) {
    return NextResponse.json({ error: error.message }, { status: error.statusCode })
  }
  console.error('Billing report GET error:', error)
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
}
