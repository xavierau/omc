/**
 * BOOK-001 W3 (R19, PDPO DPP2): one pass of the daily retention cron. Name
 * and notes are cleared on bookings dated more than 180 days ago and
 * pii_purged_at is stamped; status, party size, dates and counts remain.
 * Idempotent: already-purged rows are not selected again.
 * BOOK-013 (R16): the check-in code is cleared too and its QR file deleted;
 * QR files left on cancelled/declined bookings (diner AI cancel, a confirmed
 * change, a declined row) are swept here, so those channels stay untouched.
 * BOOK-003's unverified agent bookings are deleted by the 5-minute reminders cron
 * instead (purge-unverified-bookings.ts, review F3).
 */
import { retentionCutoffDate } from '@/domain/services/booking-reminder'
import type { BookingRetentionStore } from '@/domain/ports/booking'

/** BOOK-013 (R16): the check-in QR files in the public bucket. */
export interface QrFileJanitor {
  removePaths(paths: string[]): Promise<void>
  /** Deletes the QR files still stored on cancelled/declined bookings (any path: staff, diner AI, change); returns how many. */
  sweepClosed(limit: number): Promise<number>
}

export interface PurgeBookingPiiDeps {
  store: BookingRetentionStore
  now(): Date
  qrFiles?: QrFileJanitor
}

/** One daily pass removes at most this many leftover QR files (the next pass takes the rest). */
export const QR_SWEEP_LIMIT = 500

export async function purgeBookingPii(deps: PurgeBookingPiiDeps): Promise<{ purged: number; cutoffDate: string; qrSwept: number }> {
  const now = deps.now()
  const cutoffDate = retentionCutoffDate(now)
  const purged = await deps.store.purgePii(cutoffDate, now, deps.qrFiles?.removePaths)
  const qrSwept = deps.qrFiles ? await deps.qrFiles.sweepClosed(QR_SWEEP_LIMIT) : 0
  return { purged, cutoffDate, qrSwept }
}
