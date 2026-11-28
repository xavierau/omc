/**
 * BOOK-010 W2 (spec S3, AC-8, AC-9, AC-10, UI Feedback States): the staff
 * Bookings calendar's Capacity block (stop / resume switches, stopped-by
 * line, pending note, update error), the month-cell 已滿 / 已停止 badges, and
 * the over-limit confirm prompt.
 */
import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('next-intl', () => ({
  useTranslations: (ns: string) => (key: string, vars?: Record<string, unknown>) =>
    vars ? `${ns}.${key}:${JSON.stringify(vars)}` : `${ns}.${key}`,
  useLocale: () => 'en',
}))

import en from '@/messages/en.json'
import zhHK from '@/messages/zh-HK.json'
import { CapacityBlock } from '../bookings/capacity-block'
import { CalendarMonthGrid } from '../bookings/calendar-month-grid'
import { CalendarDayPanel } from '../bookings/calendar-day-panel'
import { OverLimitPrompt } from '../bookings/over-limit-prompt'
import {
  capacityTestKey, hkClock, pendingInPeriod, runStopToggle, sendStop, stopTargetOf, withStop, type CapacityDayView,
} from '../bookings/use-booking-capacity'
import { bookingDecisionOutcome, decideBooking, decisionOutcomeHandler, noticeFor } from '@/hooks/use-bookings'
import type { BookingItem } from '@/hooks/use-bookings'

const DATE = '2026-11-21'
const slot = (time: string, guests: number, extra: Partial<CapacityDayView['periods'][number]['slots'][number]> = {}) => ({
  time, guests, limit: 30, full: guests >= 30, stopped: false, stoppedBy: null, stoppedAt: null, ...extra,
})
const DAY: CapacityDayView = {
  date: DATE, hoursSet: true, full: false, stopped: false, stoppedBy: null, stoppedAt: null,
  periods: [
    { key: 'Lunch', label: 'Lunch', first: '12:00', last: '14:00', guests: 14, limit: 60, full: false, stopped: false, stoppedBy: null, stoppedAt: null,
      slots: [slot('12:00', 8), slot('12:30', 6)] },
    { key: 'Dinner', label: 'Dinner', first: '18:00', last: '20:00', guests: 60, limit: 60, full: true, stopped: false, stoppedBy: null, stoppedAt: null,
      slots: [slot('18:00', 6), slot('19:00', 30), slot('19:30', 22, { stopped: true, stoppedBy: 'Amy', stoppedAt: '2026-11-21T06:02:00Z' })] },
  ],
}
const html = (day: CapacityDayView, extra: Partial<Parameters<typeof CapacityBlock>[0]> = {}) =>
  renderToStaticMarkup(<CapacityBlock day={day} error={false} note={null} onToggle={() => {}} {...extra} />)

describe('capacity block shapes (S3)', () => {
  it('Accepting bookings + whole-day switch (on), one row per period with N / limit guests and a bar', () => {
    const out = html(DAY)
    expect(out).toContain('data-testid="bookings-capacity"')
    expect(out).toContain('bookings.capacity.title')
    expect(out).toMatch(/role="switch" aria-checked="true"[^>]*data-testid="bookings-capacity-day-stop"/)
    expect(out).toContain('data-testid="bookings-capacity-period-Lunch"')
    expect(out).toContain('bookings.capacity.guestsOf:{&quot;guests&quot;:14,&quot;limit&quot;:60}')
    expect(out).toContain('data-testid="bookings-capacity-period-Lunch-bar"')
    expect(out).toMatch(/role="switch" aria-checked="true"[^>]*data-testid="bookings-capacity-period-Dinner-stop"/)
  })

  it('no meal limit → "N guests" and no bar', () => {
    const day = { ...DAY, periods: [{ ...DAY.periods[0], limit: null }] }
    const out = html(day)
    expect(out).toContain('bookings.capacity.guests:{&quot;guests&quot;:14}')
    expect(out).not.toContain('bookings-capacity-period-Lunch-bar')
  })

  it('a period with a full or stopped slot starts expanded: N / limit per slot, a Full badge, a stop switch per slot', () => {
    const out = html(DAY)
    expect(out).toContain('bookings.capacity.slotOf:{&quot;guests&quot;:30,&quot;limit&quot;:30}')
    expect(out).toContain('data-testid="bookings-capacity-slot-1900-full"')
    expect(out).not.toContain('bookings-capacity-slot-1800-full')
    expect(out).toMatch(/role="switch" aria-checked="true"[^>]*data-testid="bookings-capacity-slot-1800-stop"/)
    expect(out).toMatch(/role="switch" aria-checked="false"[^>]*data-testid="bookings-capacity-slot-1930-stop"/)
    // Lunch has nothing full or stopped: collapsed, its slot switches not rendered until opened.
    expect(out).not.toContain('bookings-capacity-slot-1200-stop')
    expect(out).toMatch(/aria-expanded="false"[^>]*data-testid="bookings-capacity-period-Lunch-toggle"/)
  })

  it('a stopped item shows "Stopped by <name> · HH:MM" in Hong Kong time', () => {
    const out = html(DAY)
    expect(out).toContain('data-testid="bookings-capacity-slot-1930-stopped"')
    expect(out).toContain('bookings.capacity.stoppedBy:{&quot;name&quot;:&quot;Amy&quot;,&quot;time&quot;:&quot;14:02&quot;}')
    const stoppedDay = html({ ...DAY, stopped: true, stoppedBy: 'Ben', stoppedAt: '2026-11-21T01:30:00Z' })
    expect(stoppedDay).toMatch(/role="switch" aria-checked="false"[^>]*data-testid="bookings-capacity-day-stop"/)
    expect(stoppedDay).toContain('data-testid="bookings-capacity-day-stopped"')
    expect(stoppedDay).toContain('bookings.capacity.stoppedBy:{&quot;name&quot;:&quot;Ben&quot;,&quot;time&quot;:&quot;09:30&quot;}')
    const unknown = html({ ...DAY, stopped: true, stoppedBy: null, stoppedAt: '2026-11-21T01:30:00Z' })
    expect(unknown).toContain('bookings.capacity.stoppedAt:{&quot;time&quot;:&quot;09:30&quot;}')
  })

  it('unlabelled periods are keyed "HH:MM-HH:MM" in the API and "HHMM-HHMM" in test ids', () => {
    const day = { ...DAY, periods: [{ ...DAY.periods[0], key: '12:00-14:00', label: null }] }
    const out = html(day)
    expect(capacityTestKey('12:00-14:00')).toBe('1200-1400')
    expect(out).toContain('data-testid="bookings-capacity-period-1200-1400"')
    expect(out).toContain('12:00–14:00')
  })

  it('error → bookings-capacity-error; pending note under the stopped period', () => {
    const out = html(DAY, { error: true, note: { key: 'Dinner', count: 3 } })
    expect(out).toContain('data-testid="bookings-capacity-error"')
    expect(out).toContain('bookings.capacity.error')
    expect(out).toContain('data-testid="bookings-capacity-pending-note"')
    expect(out).toContain('bookings.capacity.pendingNote:{&quot;count&quot;:3}')
  })

  it('hours not set → nothing rendered', () => {
    expect(html({ ...DAY, hoursSet: false, periods: [] })).toBe('')
  })

  it('the day panel renders the capacity block above the rows', () => {
    const b = { id: 'b1', restaurantId: 'r', memberId: null, phone: '+85290000001', name: 'Chan', partySize: 4, bookingDate: DATE, bookingTime: '19:00',
      notes: null, status: 'pending', declineReason: null, decidedBy: null, decidedAt: null, source: 'chat', campaignId: null,
      createdAt: '2026-11-01T00:00:00Z', decisionMessageStatus: null } as BookingItem
    const out = renderToStaticMarkup(
      <CalendarDayPanel date={DATE} bookings={[b]} monthEmpty={false} busyIds={new Set()} undelivered={new Set()} onDecide={() => {}}
        capacity={<div data-testid="bookings-capacity" />} />
    )
    expect(out.indexOf('bookings-capacity')).toBeGreaterThan(0)
    expect(out.indexOf('bookings-capacity')).toBeLessThan(out.indexOf('booking-list'))
  })
})

describe('stop / resume switch (AC-8, UI Feedback States)', () => {
  const target = stopTargetOf(DATE, { scope: 'period', periodLabel: 'Dinner' })

  it('targets: day, period by key, slot by time', () => {
    expect(stopTargetOf(DATE, { scope: 'day' })).toEqual({ date: DATE, scope: 'day', periodLabel: null, time: null })
    expect(target).toEqual({ date: DATE, scope: 'period', periodLabel: 'Dinner', time: null })
    expect(stopTargetOf(DATE, { scope: 'slot', time: '19:00' })).toEqual({ date: DATE, scope: 'slot', periodLabel: null, time: '19:00' })
  })

  it('withStop flips exactly the target (optimistic)', () => {
    const next = withStop(DAY, target, true)
    expect(next.periods[1].stopped).toBe(true)
    expect(next.periods[0].stopped).toBe(false)
    expect(next.stopped).toBe(false)
    expect(withStop(DAY, stopTargetOf(DATE, { scope: 'slot', time: '19:30' }), false).periods[1].slots[2].stopped).toBe(false)
    expect(withStop(DAY, stopTargetOf(DATE, { scope: 'day' }), true).stopped).toBe(true)
  })

  it('switching off sends POST /stops, on sends DELETE, with the target body', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({}), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    expect(await sendStop(target, true)).toBe(true)
    expect(await sendStop(target, false)).toBe(true)
    const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>
    expect(calls[0][0]).toBe('/api/dashboard/bookings/stops')
    expect(calls[0][1].method).toBe('POST')
    expect(JSON.parse(String(calls[0][1].body))).toEqual({ date: DATE, scope: 'period', periodLabel: 'Dinner' })
    expect(calls[1][1].method).toBe('DELETE')
    fetchMock.mockImplementationOnce(async () => new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 }))
    expect(await sendStop(target, true)).toBe(false)
    fetchMock.mockImplementationOnce(async () => { throw new Error('offline') })
    expect(await sendStop(target, true)).toBe(false)
    vi.unstubAllGlobals()
  })

  it('success: shows the flip, clears the error, reloads capacity (and the month badges)', async () => {
    const seen: CapacityDayView[] = []
    const sinks = { apply: (d: CapacityDayView) => seen.push(d), setError: vi.fn(), reload: vi.fn() }
    const ok = await runStopToggle(sinks, { day: DAY, target, stopped: true, send: async () => true })
    expect(ok).toBe(true)
    expect(seen).toHaveLength(1)
    expect(seen[0].periods[1].stopped).toBe(true)
    expect(sinks.setError).toHaveBeenLastCalledWith(false)
    expect(sinks.reload).toHaveBeenCalledTimes(1)
  })

  it('API error: the switch reverts to what it was and the error shows', async () => {
    const seen: CapacityDayView[] = []
    const sinks = { apply: (d: CapacityDayView) => seen.push(d), setError: vi.fn(), reload: vi.fn() }
    const ok = await runStopToggle(sinks, { day: DAY, target, stopped: true, send: async () => false })
    expect(ok).toBe(false)
    expect(seen.map((d) => d.periods[1].stopped)).toEqual([true, false])
    expect(seen[1]).toBe(DAY)
    expect(sinks.setError).toHaveBeenLastCalledWith(true)
    expect(sinks.reload).not.toHaveBeenCalled()
  })

  it('pending requests in a period (the inline note count): pending only, in the period range, that date', () => {
    const mk = (time: string, status: BookingItem['status'], date = DATE) => ({ bookingDate: date, bookingTime: time, status }) as BookingItem
    const rows = [mk('18:00', 'pending'), mk('19:30', 'pending'), mk('19:00', 'confirmed'), mk('12:00', 'pending'), mk('19:00', 'pending', '2026-11-22')]
    expect(pendingInPeriod(rows, DATE, DAY.periods[1])).toBe(2)
    expect(pendingInPeriod(rows, DATE, DAY.periods[0])).toBe(1)
  })

  it('Hong Kong clock for the stopped-by line', () => {
    expect(hkClock('2026-11-21T06:02:00Z')).toBe('14:02')
    expect(hkClock('2026-11-20T16:05:00.000Z')).toBe('00:05')
  })
})

describe('month cell badges (S3, AC-9)', () => {
  const props = { bookings: [], selected: DATE, today: '2026-11-20', onSelect: () => {} }

  it('已滿 Full when no slot fits a party of 1, 已停止 Stopped when the whole day is stopped, none otherwise', () => {
    const out = renderToStaticMarkup(
      <CalendarMonthGrid {...props} badges={{ '2026-11-21': { full: true, stopped: false }, '2026-11-28': { full: true, stopped: true }, '2026-11-22': { full: false, stopped: false } }} />
    )
    expect(out).toMatch(/data-testid="bookings-calendar-day-2026-11-21-full"[^>]*data-kind="full"|data-kind="full"[^>]*data-testid="bookings-calendar-day-2026-11-21-full"/)
    expect(out).toContain('bookings.capacity.badgeFull')
    expect(out).toMatch(/data-testid="bookings-calendar-day-2026-11-28-full"[^>]*data-kind="stopped"|data-kind="stopped"[^>]*data-testid="bookings-calendar-day-2026-11-28-full"/)
    expect(out).toContain('bookings.capacity.badgeStopped')
    expect(out).not.toContain('bookings-calendar-day-2026-11-22-full')
  })

  it('no badge data → the BOOK-004 cells unchanged', () => {
    expect(renderToStaticMarkup(<CalendarMonthGrid {...props} />)).not.toContain('-full"')
  })
})

describe('over-limit confirm (AC-10)', () => {
  const overLimit = { scope: 'slot' as const, time: '19:00', guests: 34, limit: 30 }

  it('a 409 over_limit is its own outcome (not "already handled") and leaves no notice', () => {
    const outcome = bookingDecisionOutcome(409, { error: 'over_limit', overLimit })
    expect(outcome).toEqual({ kind: 'over_limit', overLimit })
    expect(noticeFor('confirm', outcome)).toBeNull()
    expect(bookingDecisionOutcome(409, { error: 'already_handled', status: 'confirmed' })).toEqual({ kind: 'already_handled', status: 'confirmed' })
  })

  it('the outcome opens the prompt for that row instead of a notice', () => {
    const sinks = { setNotice: vi.fn(), addUndelivered: vi.fn(), askOverLimit: vi.fn() }
    decisionOutcomeHandler('b1', 'confirm', sinks)({ kind: 'over_limit', overLimit })
    expect(sinks.askOverLimit).toHaveBeenCalledWith({ id: 'b1', overLimit })
    expect(sinks.setNotice).toHaveBeenCalledWith(null)
  })

  it('Confirm anyway re-sends the confirm with confirmAnyway: true; a plain confirm sends {}', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ booking: { id: 'b1' }, delivered: true }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await decideBooking('b1', 'confirm')
    await decideBooking('b1', 'confirm', undefined, { confirmAnyway: true })
    const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>
    expect(calls[0][0]).toBe('/api/dashboard/bookings/b1/confirm')
    expect(JSON.parse(String(calls[0][1].body))).toEqual({})
    expect(JSON.parse(String(calls[1][1].body))).toEqual({ confirmAnyway: true })
    vi.unstubAllGlobals()
  })

  it('the prompt: "This takes 19:00 to 34 / 30 guests. Confirm anyway?" with Confirm anyway / Cancel', () => {
    const out = renderToStaticMarkup(<OverLimitPrompt overLimit={overLimit} busy={false} onConfirm={() => {}} onCancel={() => {}} />)
    expect(out).toContain('data-testid="bookings-confirm-over-limit"')
    expect(out).toContain('role="alertdialog"')
    expect(out).toContain('bookings.capacity.overLimitSlot:{&quot;time&quot;:&quot;19:00&quot;,&quot;guests&quot;:34,&quot;limit&quot;:30}')
    expect(out).toContain('data-testid="bookings-confirm-over-limit-confirm"')
    expect(out).toContain('data-testid="bookings-confirm-over-limit-cancel"')
    const meal = renderToStaticMarkup(<OverLimitPrompt overLimit={{ scope: 'meal', period: 'Dinner', guests: 62, limit: 60 }} busy={false} onConfirm={() => {}} onCancel={() => {}} />)
    expect(meal).toContain('bookings.capacity.overLimitMeal:{&quot;period&quot;:&quot;Dinner&quot;,&quot;guests&quot;:62,&quot;limit&quot;:60}')
  })

  it('the en copy reads exactly as the spec', () => {
    const c = (en.bookings as unknown as { capacity: Record<string, string> }).capacity
    expect(c.overLimitSlot.replace('{time}', '19:00').replace('{guests}', '34').replace('{limit}', '30')).toBe('This takes 19:00 to 34 / 30 guests. Confirm anyway?')
    expect(c.error).toBe("Couldn't update. Try again.")
  })
})

describe('copy (en + zh-HK)', () => {
  it('both locales carry the same capacity keys', () => {
    const keys = (m: typeof en) => Object.keys((m.bookings as unknown as { capacity: object }).capacity).sort()
    expect(keys(zhHK as typeof en)).toEqual(keys(en))
    const zh = (zhHK.bookings as unknown as { capacity: Record<string, string> }).capacity
    expect(zh.badgeFull).toBe('已滿')
    expect(zh.badgeStopped).toBe('已停止')
  })
})
