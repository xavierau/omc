/**
 * BOOK-001 W3 (R19): booking PII retention cron, daily. Forge Scheduled Job:
 * scripts/cron/booking-retention.sh (deploy/README.md).
 * Bearer CRON_SECRET, as /api/cron/campaigns; an unset secret admits no one.
 */
import { NextRequest, NextResponse } from 'next/server'
import { purgeBookingPii } from '@/application/booking/purge-booking-pii'
import { bookingRetentionDeps } from '@/application/booking/booking-deps'

export const dynamic = 'force-dynamic'

function authorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  return Boolean(secret) && request.headers.get('authorization') === `Bearer ${secret}`
}

async function run(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    return NextResponse.json(await purgeBookingPii(bookingRetentionDeps()))
  } catch (error) {
    console.error('[Cron] booking retention failed:', (error as Error).name)
    return NextResponse.json({ error: 'Failed to purge booking data' }, { status: 500 })
  }
}

export const GET = run
export const POST = run
