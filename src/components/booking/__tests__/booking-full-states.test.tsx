// BOOK-010 W2 (spec S4: AC-12, AC-13; brief "Diner page"): 已滿 slots and days per party size, and the full recovery copy.
import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('next-intl', () => ({
  useTranslations: (ns: string) => (key: string, vars?: Record<string, unknown>) =>
    vars ? `${ns}.${key}:${JSON.stringify(vars)}` : `${ns}.${key}`,
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }))
vi.mock('@/hooks/use-booking-slot-form', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/use-booking-slot-form')>()
  return { ...actual, useBookingSlotForm: vi.fn(actual.useBookingSlotForm) }
})

import en from '@/messages/en.json'
import zhHK from '@/messages/zh-HK.json'
import { EMPTY_BOOKING_HOURS, type BookingHours } from '@/domain/value-objects/booking-hours'
import { slotsFor } from '@/domain/services/booking-hours'
import { fitsFor, type BookingStop, type RoomState } from '@/domain/services/booking-room'
import { dinerDayState, refitChoice, slotFits, timesChanged } from '../slot-picker-model'
import { DayCalendar } from '../day-calendar'
import { SlotList } from '../slot-list'
import { BookingSlotForm } from '../booking-slot-form'
import { sendSlotForm, useBookingSlotForm, type SlotFormValues } from '@/hooks/use-booking-slot-form'
import { previewBookingView, resolveBookingLink, type ResolveBookingLinkDeps, type SlotRoom } from '@/application/booking/resolve-booking-link'
import { FakeBookingSettings, FakeBookingTokens } from '@/test-utils/fake-booking'

const LUNCH = { label: '午市', first: '12:00', last: '14:00' }
const DINNER = { label: '晚市', first: '18:00', last: '21:30' }
const OPEN = [LUNCH, DINNER]
// Today Fri 2026-11-20 10:00 HK; Mon closed; 30 days ahead.
const HOURS: BookingHours = {
  ...EMPTY_BOOKING_HOURS,
  weekly: { mon: [], tue: OPEN, wed: OPEN, thu: OPEN, fri: OPEN, sat: OPEN, sun: OPEN },
  limits: { perSlot: 30, perMeal: 60 },
}
const CLOCK = { today: '2026-11-20', nowTime: '10:00' }

// Sat 21: 19:00 has 28 guests (room 2); 13:00 has 30 (room 0). Sun 22: every slot of the day has no room.
const ROOM: SlotRoom = {
  '2026-11-21': { '13:00': 0, '19:00': 2 },
  '2026-11-22': Object.fromEntries(slotsFor(HOURS, '2026-11-22', CLOCK).map((s) => [s.time, 0])),
}

describe('model (AC-12): a slot fits the party when the server says the room for it is at least the party', () => {
  it('slotFits: absent = room for any party; party null reads as 1', () => {
    expect(slotFits(ROOM, 2)('2026-11-21', '19:00')).toBe(true)
    expect(slotFits(ROOM, 4)('2026-11-21', '19:00')).toBe(false)
    expect(slotFits(ROOM, 1)('2026-11-21', '13:00')).toBe(false)
    expect(slotFits(ROOM, 8)('2026-11-21', '18:00')).toBe(true)
    expect(slotFits(undefined, 8)('2026-11-21', '13:00')).toBe(true)
    expect(slotFits(ROOM, null)('2026-11-21', '19:00')).toBe(true)
  })

  it('day: no slot fits → booked (distinct from closed); changing party re-evaluates', () => {
    expect(dinerDayState(HOURS, '2026-11-22', CLOCK, slotFits(ROOM, 1))).toBe('booked')
    expect(dinerDayState(HOURS, '2026-11-21', CLOCK, slotFits(ROOM, 4))).toBe('open')
    expect(dinerDayState(HOURS, '2026-11-23', CLOCK, slotFits(ROOM, 1))).toBe('closed')
    expect(dinerDayState(HOURS, '2026-11-25', CLOCK, slotFits(ROOM, 1))).toBe('open')
  })

  it('a party change clears a chosen time (or day) that no longer fits, and keeps one that does', () => {
    const v: SlotFormValues = { partySize: 2, date: '2026-11-21', time: '19:00', name: 'x', notes: '', accepted: false }
    expect(refitChoice(v, HOURS, CLOCK, slotFits(ROOM, 4))).toEqual({ time: '' })
    expect(refitChoice(v, HOURS, CLOCK, slotFits(ROOM, 2))).toEqual({})
    expect(refitChoice({ ...v, date: '2026-11-22', time: '' }, HOURS, CLOCK, slotFits(ROOM, 1))).toEqual({ date: '' })
  })

  it('AC-13: a full refusal counts as times changed', () => {
    expect(timesChanged({ time: 'full' })).toBe(true)
  })
})

describe('render (AC-12)', () => {
  it('a slot that cannot take the party stays visible, greyed, 已滿, data-state=full, aria-disabled; others data-state=open', () => {
    const out = renderToStaticMarkup(<SlotList hours={HOURS} clock={CLOCK} date="2026-11-21" value="" onChange={() => {}} fits={slotFits(ROOM, 4)} party={4} />)
    expect(out).toMatch(/<button[^>]*disabled=""[^>]*aria-disabled="true"[^>]*data-testid="booking-slot-1900" data-state="full"/)
    expect(out).toMatch(/data-testid="booking-slot-1300" data-state="full"/)
    expect(out).toMatch(/data-testid="booking-slot-1800" data-state="open"/)
    expect(out).toContain('booking.picker.full')
    expect(out).toContain('data-testid="booking-full-hint"')
    expect(out).toContain('booking.picker.fullHint:{&quot;party&quot;:4}')
  })

  it('a party of 2 fits 19:00: the slot is selectable again', () => {
    const out = renderToStaticMarkup(<SlotList hours={HOURS} clock={CLOCK} date="2026-11-21" value="" onChange={() => {}} fits={slotFits(ROOM, 2)} party={2} />)
    expect(out).toMatch(/data-testid="booking-slot-1900" data-state="open"/)
  })

  it('no room data → BOOK-009 slots, no 已滿 and no hint', () => {
    const out = renderToStaticMarkup(<SlotList hours={HOURS} clock={CLOCK} date="2026-11-21" value="" onChange={() => {}} />)
    expect(out).not.toContain('data-state="full"')
    expect(out).not.toContain('booking-full-hint')
  })

  it('a day with no fitting slot is greyed with 已滿 (not 休息), data-state=full, not selectable; legend shows 已滿', () => {
    const out = renderToStaticMarkup(<DayCalendar hours={HOURS} clock={CLOCK} value="" onChange={() => {}} fits={slotFits(ROOM, 1)} />)
    expect(out).toMatch(/disabled=""[^>]*aria-disabled="true"[^>]*data-testid="booking-day-2026-11-22" data-state="full"/)
    expect(out).toMatch(/data-testid="booking-day-2026-11-22"[^>]*>(?:(?!<\/button>).)*booking\.picker\.full/)
    expect(out).toMatch(/data-testid="booking-day-2026-11-23" data-state="closed"/)
    expect(out).toContain('data-testid="booking-legend-full"')
  })

  it('the form passes the chosen party to the calendar and slots', () => {
    vi.mocked(useBookingSlotForm).mockImplementationOnce(() => ({
      values: { partySize: 4, date: '2026-11-21', time: '', name: '', notes: '', accepted: false }, set: () => {}, submitting: false,
      missing: 'time', submit: async () => {}, outcome: null, changedTime: null,
    }))
    const out = renderToStaticMarkup(
      <BookingSlotForm token="t" maskedPhone="•••• 4567" maxPartySize={8} retryUrl={null} today={CLOCK.today} schedule={{ hours: HOURS, nowTime: '10:00', room: ROOM }} />
    )
    expect(out).toMatch(/data-testid="booking-slot-1900" data-state="full"/)
    expect(out).toMatch(/data-testid="booking-day-2026-11-22" data-state="full"/)
  })
})

describe('full recovery (AC-13)', () => {
  it('a full refusal clears the time, keeps the rest, and names the time', async () => {
    const v: SlotFormValues = { partySize: 4, date: '2026-11-21', time: '19:00', name: '陳', notes: '', accepted: true }
    const step = await sendSlotForm('tok', v, false, async () => ({ kind: 'fields', errors: { time: 'full' } }))
    expect(step.values).toEqual({ ...v, time: '' })
    expect(step.changedTime).toBe('19:00')
  })

  it('the times-changed notice uses the full copy (這個時段剛剛滿了) on a full refusal', () => {
    vi.mocked(useBookingSlotForm).mockImplementationOnce(() => ({
      values: { partySize: 4, date: '2026-11-21', time: '', name: '陳', notes: '', accepted: false }, set: () => {}, submitting: false,
      missing: 'time', submit: async () => {}, outcome: { kind: 'fields', errors: { time: 'full' } }, changedTime: '19:00',
    }))
    const out = renderToStaticMarkup(
      <BookingSlotForm token="t" maskedPhone="•••• 4567" maxPartySize={8} retryUrl={null} today={CLOCK.today} schedule={{ hours: HOURS, nowTime: '10:00', room: ROOM }} />
    )
    expect(out).toContain('data-testid="booking-times-changed"')
    expect(out).toContain('data-reason="full"')
    expect(out).toContain('booking.picker.fullTitle')
    expect(out).toContain('booking.picker.fullBody:{&quot;time&quot;:&quot;19:00&quot;}')
    expect(zhHK.booking.picker).toHaveProperty('fullTitle', '這個時段剛剛滿了')
    expect(en.booking.picker).toHaveProperty('fullTitle')
  })
})

describe('view model room (the server decides; AC-12, AC-14 rules)', () => {
  const A = 'rest-a'
  const TOKEN = 'A'.repeat(43)
  const stop = (s: Partial<BookingStop>): BookingStop => ({ date: '2026-11-21', scope: 'slot', periodLabel: null, time: null, stoppedById: null, stoppedByName: 'Amy', stoppedAt: '2026-11-20T01:00:00Z', ...s })
  const STATE: RoomState = { counts: { '2026-11-21': { '19:00': 28, '13:00': 30, '18:00': 26 } }, stops: [stop({ time: '20:00' })] }

  function deps(room?: RoomState | 'throws'): ResolveBookingLinkDeps & { reads: string[] } {
    const tokens = new FakeBookingTokens()
    tokens.add({ token: TOKEN, restaurantId: A, phone: '+85291234567', source: 'chat', campaignId: null })
    const settings = new FakeBookingSettings()
    settings.restaurants.set(A, { name: 'Kushiro', logoUrl: null, whatsappNumber: '+85220000001' })
    settings.setConfig(A, { mode: 'simple', maxPartySize: 8, bookingHours: HOURS })
    const reads: string[] = []
    const reader = room === undefined ? undefined : {
      async readRoom(restaurantId: string, from: string, to: string) {
        reads.push(`${restaurantId} ${from}..${to}`)
        if (room === 'throws') throw new Error('db down')
        return room
      },
    }
    // 2026-11-20 02:00 UTC = 10:00 HK.
    return { tokens, settings, now: () => new Date('2026-11-20T02:00:00.000Z'), ...(reader ? { room: reader } : {}), reads }
  }

  it('per date/slot: the largest party the shared rule (fitsFor) still takes, only where below the max party; read for today..window end', async () => {
    const d = deps(STATE)
    const view = await resolveBookingLink(d, TOKEN)
    if (view.kind !== 'form' || !view.schedule) throw new Error('expected the slot form')
    const room = view.schedule.room ?? {}
    // Dinner holds 54 of 60 (meal room 6): 18:00 slot room 4, 19:00 slot room 2, 20:00 stopped; the rest of dinner 6.
    // Lunch holds 30 of 60: only 13:00 (30 / 30) is below 8.
    expect(room['2026-11-21']).toEqual({
      '13:00': 0, '18:00': 4, '18:30': 6, '19:00': 2, '19:30': 6, '20:00': 0, '20:30': 6, '21:00': 6, '21:30': 6,
    })
    expect(d.reads).toEqual([`${A} 2026-11-20..2026-12-20`])
    // Every entry agrees with the server rule for every party size.
    for (const [date, times] of Object.entries(room)) {
      for (const [time, max] of Object.entries(times)) {
        for (let p = 1; p <= 8; p++) expect(fitsFor(HOURS, STATE, p)(date, time), `${date} ${time} party ${p}`).toBe(p <= max)
      }
    }
  })

  it('no stops or counts → no room entries; no room reader → no room (BOOK-009 page)', async () => {
    const empty = await resolveBookingLink(deps({ counts: {}, stops: [] }), TOKEN)
    expect(empty.kind === 'form' && empty.schedule?.room).toEqual({})
    const none = await resolveBookingLink(deps(), TOKEN)
    expect(none.kind === 'form' && none.schedule && 'room' in none.schedule).toBe(false)
  })

  it('a failed room read leaves the page usable without room (the submit check still refuses)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const view = await resolveBookingLink(deps('throws'), TOKEN)
    expect(view.kind).toBe('form')
    expect(view.kind === 'form' && view.schedule && 'room' in view.schedule).toBe(false)
  })

  it('the admin Preview shows the same room', async () => {
    const view = await previewBookingView(deps(STATE), A)
    expect(view.kind === 'form' && view.schedule?.room?.['2026-11-21']?.['19:00']).toBe(2)
  })
})
