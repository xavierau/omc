/**
 * BOOK-001 W3 (R19, PDPO DPP2): one pass of the daily retention cron. Name
 * and notes are cleared on bookings dated more than 180 days ago and
 * pii_purged_at is stamped; status, party size, dates and counts remain.
 * Idempotent: already-purged rows are not selected again.
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
  return { purged: await deps.store.purgePii(cutoffDate, now), cutoffDate }
}
