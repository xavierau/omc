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

  it('purges name, notes and the code only on rows before the cutoff that are not yet purged (QR paths are left to the QR step)', async () => {
    const rec = use([{ data: [{ id: 'a' }, { id: 'b' }] }])
    expect(await purgeBookingPii('2026-05-16', AT)).toBe(2)
    const q = rec.queries[0]
    expect(q.calls[0]).toEqual(['update', { name: null, notes: null, checkin_code: null, pii_purged_at: AT.toISOString() }])
    expect(filtersOf(q)).toEqual(['lt:booking_date=2026-05-16', 'is:pii_purged_at=null'])
  })

  describe('BOOK-013 (R16, review R3): QR files of rows before the cutoff', () => {
    // A stand-in table: rows with stored QR paths, served in id order under PostgREST max_rows (1000).
    const path = (i: number) => `${String(i).padStart(22, 'p')}.png`
    const id = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`
    const table = (n: number) => Array.from({ length: n }, (_, i) => ({ id: id(i), checkin_qr_path: path(i) }))

    function useQrTable(rows: Array<{ id: string; checkin_qr_path: string }>, opts: { readFails?: boolean } = {}) {
      const forgotten: string[][] = []
      const rec = use((q) => {
        if (q.table === 'rpc:forget_checkin_qr_paths') {
          const paths = (q.calls[0][1] as { p_paths: string[] }).p_paths
          forgotten.push(paths)
          return { data: paths.length }
        }
        if (q.calls[0][0] === 'update') return { data: [{ id: 'purged' }] }
        if (opts.readFails) return { error: { message: 'read boom' } }
        const after = q.calls.find(([m, c]) => m === 'gt' && c === 'id')?.[2] as string | undefined
        const limit = Math.min(q.calls.find(([m]) => m === 'limit')?.[1] as number, 1000)
        return { data: rows.filter((r) => !after || r.id > after).slice(0, limit) }
      })
      return { rec, forgotten }
    }

    it('reads every page by id (2001 rows → 3 pages), deletes each page, then forgets exactly the paths it deleted', async () => {
      const rows = table(2001)
      const { rec, forgotten } = useQrTable(rows)
      const removed: string[][] = []
      expect(await purgeBookingPii('2026-05-16', AT, async (paths) => void removed.push(paths))).toBe(1)
      expect(removed.map((p) => p.length)).toEqual([1000, 1000, 1])
      expect(removed.flat()).toEqual(rows.map((r) => r.checkin_qr_path))
      expect(forgotten).toEqual(removed)
      const reads = rec.queries.filter((q) => q.calls[0][0] === 'select')
      expect(reads.map((q) => filtersOf(q))).toEqual([
        ['lt:booking_date=2026-05-16', 'not:checkin_qr_path=is.null'],
        ['lt:booking_date=2026-05-16', 'not:checkin_qr_path=is.null', `gt:id=${id(999)}`],
        ['lt:booking_date=2026-05-16', 'not:checkin_qr_path=is.null', `gt:id=${id(1999)}`],
      ])
      // The PII purge runs after the files and never nulls a QR path itself.
      const purge = rec.queries[rec.queries.length - 1]
      expect(purge.calls[0]).toEqual(['update', { name: null, notes: null, checkin_code: null, pii_purged_at: AT.toISOString() }])
    })

    it('a QR delete that throws: that page keeps its paths, the other pages go on, PII is still purged, the log is masked', async () => {
      const rows = table(2001)
      const { rec, forgotten } = useQrTable(rows)
      const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
      let call = 0
      const remove = async (paths: string[]) => {
        if (++call === 2) throw new Error(`storage refused ${paths[0]}`)
      }
      expect(await purgeBookingPii('2026-05-16', AT, remove)).toBe(1)
      expect(forgotten.map((p) => p.length)).toEqual([1000, 1])
      expect(forgotten.flat()).not.toContain(path(1000))
      expect(rec.queries[rec.queries.length - 1].calls[0][0]).toBe('update')
      const text = JSON.stringify(logged.mock.calls)
      expect(text).toContain('[BookingRetention]')
      expect(text).not.toContain('pppp')
    })

    it('a QR read error never blocks the PII purge', async () => {
      const { rec, forgotten } = useQrTable([], { readFails: true })
      vi.spyOn(console, 'error').mockImplementation(() => {})
      expect(await purgeBookingPii('2026-05-16', AT, async () => {})).toBe(1)
      expect(forgotten).toEqual([])
      expect(rec.queries[rec.queries.length - 1].calls[0][0]).toBe('update')
    })
  })

  it('surfaces a database error instead of reporting zero', async () => {
    use([{ error: { message: 'boom' } }])
    await expect(purgeBookingPii('2026-05-16', AT)).rejects.toThrow('purgeBookingPii: boom')
  })
})
