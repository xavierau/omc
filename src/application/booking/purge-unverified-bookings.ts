/**
 * BOOK-003 (R41, review F3 on PR #186): agent bookings still unverified an
 * hour after they were made (their 30-minute window long over) are deleted
 * outright. Runs in the 5-minute booking-reminders cron, as its own step, so a row
 * lives at most about 65 minutes; the daily retention pass would have kept it
 * for up to ~25 hours.
 */
import { UNVERIFIED_RETENTION_MS } from '@/domain/entities/booking-request'
import type { UnverifiedBookingPurgeStore } from '@/domain/ports/booking'

export interface PurgeUnverifiedBookingsDeps {
  store: UnverifiedBookingPurgeStore
  now(): Date
}

export async function purgeUnverifiedBookings(deps: PurgeUnverifiedBookingsDeps): Promise<{ unverifiedDeleted: number }> {
  const unverifiedDeleted = await deps.store.purgeUnverified(new Date(deps.now().getTime() - UNVERIFIED_RETENTION_MS))
  return { unverifiedDeleted }
}
