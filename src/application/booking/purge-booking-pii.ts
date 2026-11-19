/**
 * BOOK-001 W3 (R19, PDPO DPP2): one pass of the daily retention cron. Name
 * and notes are cleared on bookings dated more than 180 days ago and
 * pii_purged_at is stamped; status, party size, dates and counts remain.
 * Idempotent: already-purged rows are not selected again.
 * BOOK-003's unverified agent bookings are deleted by the 5-minute reminders cron
 * instead (purge-unverified-bookings.ts, review F3).
 */
import { retentionCutoffDate } from '@/domain/services/booking-reminder'
import type { BookingRetentionStore } from '@/domain/ports/booking'

export interface PurgeBookingPiiDeps {
  store: BookingRetentionStore
  now(): Date
}

export async function purgeBookingPii(deps: PurgeBookingPiiDeps): Promise<{ purged: number; cutoffDate: string }> {
  const now = deps.now()
  const cutoffDate = retentionCutoffDate(now)
  const purged = await deps.store.purgePii(cutoffDate, now)
  return { purged, cutoffDate }
}
