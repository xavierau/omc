// BOOK-001 W3-07/W3-08: the SHAPE of the cron queries — the reminder claim is
// a conditional UPDATE on reminder_sent_at IS NULL (CAS), and the purge only
// touches rows past the cutoff that are not yet purged, clearing name and
// notes and nothing else.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { recordingSupabase, filtersOf } from '@/test-utils/recording-supabase'

vi.mock('@/infrastructure/supabase/client', () => ({ createServerSupabaseClient: vi.fn() }))

import { createServerSupabaseClient } from '@/infrastructure/supabase/client'
import { claimBookingReminder, listReminderCandidates, purgeBookingPii } from '../booking-request-repository'

function use(results: Parameters<typeof recordingSupabase>[0]) {
  const rec = recordingSupabase(results)
  vi.mocked(createServerSupabaseClient).mockReturnValue(rec.client as never)
  return rec
}

const AT = new Date('2026-11-20T09:00:00.000Z')

beforeEach(() => vi.clearAllMocks())

describe('booking cron queries', () => {
  // F7 (review #5, S-4): the start window and the booked-3h-ahead rule are
  // applied in SQL (booking_reminder_candidates, migration 082), ordered by
  // booking date and time, so not-yet-due rows can never crowd due ones out
  // of the batch limit. Semantics: booking-cron.db.test.ts.
  it('asks the database for due reminders at this instant, 3h lead, bounded', async () => {
    const rec = use([{ data: [] }])
    await listReminderCandidates(AT, 500)
    const q = rec.queries[0]
    expect(q.table).toBe('rpc:booking_reminder_candidates')
    expect(q.calls[0]).toEqual(['rpc', { p_now: AT.toISOString(), p_lead_hours: 3, p_limit: 500 }])
    expect(q.calls.some(([m]) => m === 'select')).toBe(true)
  })

  it('surfaces a candidate query error', async () => {
    use([{ error: { message: 'boom' } }])
    await expect(listReminderCandidates(AT, 500)).rejects.toThrow('listReminderCandidates: boom')
  })

  it('claims a reminder with a conditional UPDATE and reports whether this caller won', async () => {
    const rec = use([{ data: [{ id: 'b-1' }] }, { data: [] }])
    expect(await claimBookingReminder('b-1', AT)).toBe(true)
    expect(await claimBookingReminder('b-1', AT)).toBe(false)
    const q = rec.queries[0]
    expect(q.calls[0]).toEqual(['update', { reminder_sent_at: AT.toISOString() }])
    expect(filtersOf(q)).toEqual(['eq:id=b-1', 'eq:status=confirmed', 'is:reminder_sent_at=null'])
  })

  it('purges name and notes only on rows before the cutoff that are not yet purged', async () => {
    const rec = use([{ data: [{ id: 'a' }, { id: 'b' }] }])
    expect(await purgeBookingPii('2026-05-16', AT)).toBe(2)
    const q = rec.queries[0]
    expect(q.calls[0]).toEqual(['update', { name: null, notes: null, pii_purged_at: AT.toISOString() }])
    expect(filtersOf(q)).toEqual(['lt:booking_date=2026-05-16', 'is:pii_purged_at=null'])
  })

  it('surfaces a database error instead of reporting zero', async () => {
    use([{ error: { message: 'boom' } }])
    await expect(purgeBookingPii('2026-05-16', AT)).rejects.toThrow('purgeBookingPii: boom')
  })
})
