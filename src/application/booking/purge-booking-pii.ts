/**
 * BOOK-001 W3 (R19, PDPO DPP2): one pass of the daily retention cron. Name
 * and notes are cleared on bookings dated more than 180 days ago and
 * pii_purged_at is stamped; status, party size, dates and counts remain.
 * Idempotent: already-purged rows are not selected again.
 * BOOK-003 (R41): the same pass deletes agent bookings still unverified an
 * hour after they were made (their 30-minute window long over).
 */
import { retentionCutoffDate } from '@/domain/services/booking-reminder'
import { UNVERIFIED_RETENTION_MS } from '@/domain/entities/booking-request'
import type { BookingRetentionStore, UnverifiedBookingPurgeStore } from '@/domain/ports/booking'

export interface PurgeBookingPiiDeps {
  store: BookingRetentionStore
  unverified: UnverifiedBookingPurgeStore
  now(): Date
}

export async function purgeBookingPii(
  deps: PurgeBookingPiiDeps
): Promise<{ purged: number; cutoffDate: string; unverifiedDeleted: number }> {
  const now = deps.now()
  const cutoffDate = retentionCutoffDate(now)
  const purged = await deps.store.purgePii(cutoffDate, now)
  const unverifiedDeleted = await deps.unverified.purgeUnverified(new Date(now.getTime() - UNVERIFIED_RETENTION_MS))
  return { purged, cutoffDate, unverifiedDeleted }
}
