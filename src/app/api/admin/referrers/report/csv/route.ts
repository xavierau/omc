import { NextRequest, NextResponse } from 'next/server'
import { assertPlatformAdmin } from '@/infrastructure/supabase/guards/platform-admin-guard'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'
import { checkAdminRateLimit } from '@/infrastructure/rate-limit/admin-rate-limit'
import {
  generateReferrerReport,
  type CommissionRow,
} from '@/application/generate-referrer-report'

const MONTH_REGEX = /^\d{4}-\d{2}$/
const HEADER = 'Referrer,Tenant,Messages Sent,Rate (HK$/msg),Commission (HK$)'

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

    const report = await generateReferrerReport(month)
    const csv = buildCsv(report.commissions)
    const filename = `referrer-commissions-${report.month}.csv`

    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })
  } catch (error) {
    return handleError(error)
  }
}

function buildCsv(commissions: CommissionRow[]): string {
  if (commissions.length === 0) return HEADER
  return [HEADER, ...commissions.map(formatRow)].join('\n')
}

function formatRow(row: CommissionRow): string {
  return [
    escapeCsvField(row.referrerName),
    escapeCsvField(row.tenantName),
    row.messagesSent,
    row.commissionPerMessage.toFixed(2),
    row.totalCommission.toFixed(2),
  ].join(',')
}

function escapeCsvField(value: string): string {
  if (/[,"\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`
  return value
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
  console.error('Referrer report CSV error:', error)
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
}
