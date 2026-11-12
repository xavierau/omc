/**
 * BOOK-001 W3 (AC-15): booking reminder cron, every 5 minutes. Forge
 * Scheduled Job: scripts/cron/booking-reminders.sh (deploy/README.md).
 * Bearer CRON_SECRET, as /api/cron/campaigns; an unset secret admits no one.
 */
import { NextRequest, NextResponse } from 'next/server'
import { sendBookingReminders } from '@/application/booking/send-booking-reminders'
import { bookingReminderDeps } from '@/application/booking/booking-deps'

export const dynamic = 'force-dynamic'

function authorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  return Boolean(secret) && request.headers.get('authorization') === `Bearer ${secret}`
}

async function run(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    return NextResponse.json(await sendBookingReminders(bookingReminderDeps()))
  } catch (error) {
    console.error('[Cron] booking reminders failed:', (error as Error).name)
    return NextResponse.json({ error: 'Failed to send booking reminders' }, { status: 500 })
  }
}

export const GET = run
export const POST = run
