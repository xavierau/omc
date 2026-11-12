// In-memory stores for the booking cron jobs (BOOK-001 W3), with the same
// atomicity as the SQL: a reminder claim is one conditional UPDATE on
// reminder_sent_at IS NULL, so two overlapping runs claim a booking once.
import type { BookingRequest } from '@/domain/entities/booking-request'
import type { BookingReminderStore, BookingRetentionStore } from '@/domain/ports/booking'

export type CronBookingRow = BookingRequest & { reminderSentAt: string | null; piiPurgedAt: string | null }

const tick = () => new Promise<void>((resolve) => setImmediate(resolve))

export function cronBooking(overrides: Partial<CronBookingRow> = {}): CronBookingRow {
  return {
    id: 'b-1', restaurantId: 'rest-a', memberId: null, phone: '+85291234567', name: 'Chan Tai Man', partySize: 4,
    bookingDate: '2026-11-20', bookingTime: '19:30', notes: 'window seat', status: 'confirmed', declineReason: null,
    decidedBy: 'u-1', decidedAt: '2026-11-12T01:00:00.000Z', source: 'chat', campaignId: null,
    createdAt: '2026-11-12T00:00:00.000Z', reminderSentAt: null, piiPurgedAt: null,
    ...overrides,
  }
}

export class FakeBookingCronStore implements BookingReminderStore, BookingRetentionStore {
  constructor(readonly rows: CronBookingRow[] = []) {}

  async listReminderCandidates(fromDate: string, toDate: string, limit: number) {
    await tick()
    return this.rows
      .filter((r) => r.status === 'confirmed' && r.reminderSentAt === null)
      .filter((r) => r.bookingDate >= fromDate && r.bookingDate <= toDate)
      .slice(0, limit)
      .map((r) => ({ ...r }))
  }

  async claimReminder(id: string, at: Date) {
    await tick()
    const row = this.rows.find((r) => r.id === id && r.reminderSentAt === null)
    if (!row) return false
    row.reminderSentAt = at.toISOString()
    return true
  }

  async purgePii(beforeDate: string, at: Date) {
    await tick()
    const due = this.rows.filter((r) => r.bookingDate < beforeDate && r.piiPurgedAt === null)
    for (const r of due) Object.assign(r, { name: null, notes: null, piiPurgedAt: at.toISOString() })
    return due.length
  }
}
