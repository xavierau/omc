/**
 * BOOK-001 W3 (AC-15): booking reminder cron, every 5 minutes. Forge
 * Scheduled Job: scripts/cron/booking-reminders.sh (deploy/README.md).
 * Bearer CRON_SECRET, as /api/cron/campaigns; an unset secret admits no one.
 * BOOK-003 (R41, review F3): the same run deletes unverified agent bookings
 * older than an hour. Each step runs even when the other throws; a failed
 * step makes the run a 500 that names it, without internals.
 */
import { NextRequest, NextResponse } from 'next/server'
import { sendBookingReminders } from '@/application/booking/send-booking-reminders'
import { purgeUnverifiedBookings } from '@/application/booking/purge-unverified-bookings'
import { bookingReminderDeps, unverifiedBookingPurgeDeps } from '@/application/booking/booking-deps'

export const dynamic = 'force-dynamic'

function authorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  return Boolean(secret) && request.headers.get('authorization') === `Bearer ${secret}`
}

type Step<T> = { ok: true; value: T } | { ok: false; error: string }

async function step<T>(label: string, error: string, run: () => Promise<T>): Promise<Step<T>> {
  try {
    return { ok: true, value: await run() }
  } catch (err) {
    console.error(`[Cron] ${label} failed:`, (err as Error).name)
    return { ok: false, error }
  }
}

async function run(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const reminders = await step('booking reminders', 'Failed to send booking reminders', () =>
    sendBookingReminders(bookingReminderDeps())
  )
  const purge = await step('unverified booking purge', 'Failed to delete unverified bookings', () =>
    purgeUnverifiedBookings(unverifiedBookingPurgeDeps())
  )
  const body = { ...(reminders.ok ? reminders.value : {}), ...(purge.ok ? purge.value : {}) }
  const errors = [reminders, purge].flatMap((s) => (s.ok ? [] : [s.error]))
  if (errors.length > 0) return NextResponse.json({ error: errors.join('; '), ...body }, { status: 500 })
  return NextResponse.json(body)
}

export const GET = run
export const POST = run
