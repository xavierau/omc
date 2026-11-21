// BOOK-010 (spec AC-4, AC-7, AC-8, AC-15): our AI reply agent's booking tools
// refuse a slot that cannot take the party with `full` + suggestedTimes that
// fit, the create/confirm steps write through the atomic check-and-insert,
// and BOOKING RULES says only that times may be full.
// FakeClock: 2026-11-19T10:00Z = Thu 18:00 in Hong Kong; each job() is +1 min. 2026-11-21 is a Saturday.
import { describe, it, expect } from 'vitest'
import { createAgentToolExecutor } from '@/application/agent/agent-tools'
import { bookingSkill } from '@/application/agent/skills/booking-skill'
import { AGENT_TOOL_NAMES, DEFAULT_DISCLOSURE_TEXT } from '@/domain/value-objects/agent-config'
import { FULL_TIMES_RULE } from '@/domain/services/agent-booking'
import { EMPTY_BOOKING_HOURS, type BookingHours } from '@/domain/value-objects/booking-hours'
import type { BookingConfig } from '@/domain/value-objects/booking-config'
import { FakeAgentStore, FakeClock, fakeBookingWorld, fakeToolData } from '@/application/__tests__/agent-fakes'

const R = 'rest-a'
const PHONE = '+85291234567'
const KEY = { restaurantId: R, phone: PHONE }
const DAY = '2026-11-21'
const lunchDinner = [
  { label: '午市', first: '12:00', last: '14:00' },
  { label: '晚市', first: '18:00', last: '21:30' },
]
const HOURS: BookingHours = {
  ...EMPTY_BOOKING_HOURS,
  weekly: { mon: lunchDinner, tue: lunchDinner, wed: lunchDinner, thu: lunchDinner, fri: lunchDinner, sat: lunchDinner, sun: lunchDinner },
  intervalMinutes: 30,
  noticeHours: 2,
  aheadDays: 30,
  limits: { perSlot: 30, perMeal: null },
}
const GOOD = { date: DAY, time: '19:00', partySize: 4, name: '陳生' }
const SUGGESTED = [
  { date: DAY, time: '19:30' },
  { date: DAY, time: '18:00' },
  { date: DAY, time: '20:00' },
]

function setup(patch: Partial<BookingConfig> = {}) {
  const clock = new FakeClock()
  const store = new FakeAgentStore(clock)
  const world = fakeBookingWorld(clock)
  world.settings.setConfig(R, { mode: 'simple', maxPartySize: 8, bookingHours: HOURS, ...patch })
  world.settings.restaurants.set(R, { name: 'OMC', logoUrl: null, whatsappNumber: null })

  async function job() {
    world.proposals.deliverAll()
    clock.advance(60_000)
    const row = store.seed({ restaurant_id: R, phone: PHONE, role: 'user', text: 'msg' })
    const { getConfig, ...ports } = world.deps
    return createAgentToolExecutor({
      key: KEY, enabledTools: [...AGENT_TOOL_NAMES], handoffSilenceHours: 12, now: clock.now, data: fakeToolData(),
      silences: store, agentMode: 'auto',
      booking: {
        ...ports, room: world.room, config: await getConfig(R), inboundCreatedAt: () => store.userMessageCreatedAt(KEY, row.id),
        proposalOwner: `run-${row.id}`, disclosureText: DEFAULT_DISCLOSURE_TEXT,
      },
    })
  }

  /** Guests already booked by someone else (confirmed). */
  async function guests(time: string, partySize: number, date = DAY) {
    const row = await world.requests.insert({
      restaurantId: R, memberId: null, phone: '+85290000000', name: 'Other', partySize, bookingDate: date, bookingTime: time,
      notes: null, source: 'chat', campaignId: null, token: `tok-${Math.random()}`,
    })
    row.status = 'confirmed'
    return row
  }

  const agentRows = () => world.requests.rows.filter((r) => r.source === 'agent')
  return { world, job, guests, agentRows }
}

describe('AC-4 propose_booking refuses a full slot', () => {
  it('AC-4: 28 of 30, party of 4 → error invalid, fields.time full, suggestedTimes that fit; no proposal', async () => {
    const { world, job, guests } = setup()
    await guests('19:00', 28)
    await guests('18:30', 28)
    const out = await (await job())('propose_booking', GOOD)
    expect(out).toMatchObject({ error: 'invalid', fields: { time: 'full' }, suggestedTimes: SUGGESTED })
    expect(String(out.note)).toMatch(/full/i)
    expect(world.proposals.entries.size).toBe(0)
  })

  it('AC-8: a stopped period → full', async () => {
    const { world, job } = setup()
    world.room.seedStop(R, { date: DAY, scope: 'period', periodLabel: '晚市' })
    expect(await (await job())('propose_booking', GOOD)).toMatchObject({ error: 'invalid', fields: { time: 'full' } })
  })
})

describe('AC-7 create_booking_request after the slot filled', () => {
  it('AC-7: proposed with room, filled before the diner agreed → full + suggestions, nothing created', async () => {
    const { job, guests, agentRows } = setup()
    await guests('19:00', 24)
    expect(await (await job())('propose_booking', GOOD)).toMatchObject({ proposed: true })
    await guests('19:00', 4)
    const out = await (await job())('create_booking_request', {})
    expect(out).toMatchObject({ error: 'invalid', fields: { time: 'full' } })
    expect(out.suggestedTimes).toEqual(expect.arrayContaining([{ date: DAY, time: '19:30' }]))
    expect(agentRows()).toHaveLength(0)
  })

  it('room left → created through the atomic insert', async () => {
    const { world, job, guests, agentRows } = setup()
    await guests('19:00', 20)
    await (await job())('propose_booking', GOOD)
    expect(await (await job())('create_booking_request', {})).toMatchObject({ booked: true })
    expect(agentRows()).toHaveLength(1)
    expect(world.room.calls.some((c) => c.startsWith('insertIfRoom'))).toBe(true)
  })

  it('AC-3: no limits → booked even when the slot holds many guests', async () => {
    const { job, guests, agentRows } = setup({ bookingHours: { ...HOURS, limits: undefined } })
    await guests('19:00', 400)
    await (await job())('propose_booking', GOOD)
    expect(await (await job())('create_booking_request', {})).toMatchObject({ booked: true })
    expect(agentRows()).toHaveLength(1)
  })
})

describe('AC-4 change requests count at the new time', () => {
  async function withBooking() {
    const t = setup()
    const mine = await t.world.requests.insert({
      restaurantId: R, memberId: null, phone: PHONE, name: '陳生', partySize: 2, bookingDate: DAY, bookingTime: '12:00',
      notes: null, source: 'chat', campaignId: null, token: 'tok-mine',
    })
    mine.status = 'confirmed'
    const ref = ((await (await t.job())('list_my_bookings', {})).bookings as Array<{ ref: string }>)[0].ref
    return { ...t, ref }
  }

  it('propose_booking_change to a full time → full + suggestions, nothing stored', async () => {
    const { world, job, guests, ref } = await withBooking()
    await guests('19:00', 30)
    const out = await (await job())('propose_booking_change', { bookingRef: ref, time: '19:00' })
    expect(out).toMatchObject({ error: 'invalid', fields: { time: 'full' } })
    expect(world.proposals.entries.size).toBe(0)
  })

  it('confirm_booking_change after the new time filled → full, no change request', async () => {
    const { world, job, guests, ref } = await withBooking()
    await guests('19:00', 26)
    expect(await (await job())('propose_booking_change', { bookingRef: ref, time: '19:00' })).toMatchObject({ proposed: true })
    await guests('19:00', 3)
    expect(await (await job())('confirm_booking_change', {})).toMatchObject({ error: 'invalid', fields: { time: 'full' } })
    expect(world.requests.rows.filter((r) => r.replacesBookingId)).toHaveLength(0)
  })
})

describe('AC-15 BOOKING RULES', () => {
  const ctx = (hours: BookingHours | null) => ({
    offeredTools: [...AGENT_TOOL_NAMES],
    bookingRules: '',
    bookingHours: hours ? { hours, maxPartySize: 8, today: '2026-11-19' } : null,
  })

  it('AC-15: hours set → "some times may be full; always propose to check", never the numbers', () => {
    const text = bookingSkill.dataSection?.(ctx(HOURS)) ?? ''
    expect(text).toContain(FULL_TIMES_RULE.en)
    expect(text).not.toMatch(/30 位|30 guests/)
    expect(text.endsWith('Other booking notes:\n(none provided)')).toBe(true)
  })

  it('hours not set → no full line (the AGENT-005 text)', () => {
    expect(bookingSkill.dataSection?.(ctx(null)) ?? '').not.toContain(FULL_TIMES_RULE.en)
  })
})
