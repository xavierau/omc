/**
 * BOOK-013 S1–S3, S7 (spec AC-1–AC-13, AC-16, AC-19, AC-21, AC-22, AC-24;
 * threat R1–R7, R9, R11, R12, R14, R15, R17): the staff booking routes run
 * for real over in-memory stores with migration 095's conditions
 * (test-utils/fake-staff-booking.ts). Only the session, storage and the
 * WhatsApp send are faked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { FakeCheckinQr, FakeStaffBookings, staffRow, type StaffRow } from '@/test-utils/fake-staff-booking'
import { FakeBookingRoom } from '@/application/booking/__tests__/fake-booking-room'
import { DEFAULT_BOOKING_CONFIG, type BookingConfig } from '@/domain/value-objects/booking-config'
import { EMPTY_BOOKING_HOURS } from '@/domain/value-objects/booking-hours'
import { parseE164Phone } from '@/infrastructure/phone/e164-parser'
import { isPhoneNormalizeError } from '@/domain/ports/phone-normalizer'
import type { StaffBookingDeps } from '@/application/booking/staff-booking-shared'
import type { BookingCheckInDeps } from '@/application/booking/booking-check-in'
import type { BookingMessageInput, BookingSendResult } from '@/domain/ports/booking'

const world: { staff: StaffBookingDeps | null; checkin: BookingCheckInDeps | null } = { staff: null, checkin: null }

vi.mock('@/infrastructure/supabase/guards/tenant-guard')
vi.mock('@/application/booking/booking-deps', () => ({
  staffBookingDeps: () => world.staff,
  bookingCheckInDeps: () => world.checkin,
}))
vi.mock('@/infrastructure/supabase/repositories/booking-room-repository', () => ({
  findStaffDisplayName: vi.fn(async (id: string) => (id === STAFF ? 'Mandy' : null)),
}))

import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'
import { POST as createRoute } from '../route'
import { PATCH as editRoute } from '../[id]/route'
import { POST as cancelRoute } from '../[id]/cancel/route'
import { POST as arrivedRoute, DELETE as undoRoute } from '../[id]/check-in/route'
import { GET as todayRoute } from '../today/route'
import { GET as byCodeRoute } from '../by-code/[code]/route'

const A = 'rest-a'
const B = 'rest-b'
const STAFF = '7c0f4a3e-0000-4000-8000-00000000aaaa'
const MEMBER = 'm-0001'
// Thursday 2026-11-26 11:00 in Hong Kong.
const NOW = new Date('2026-11-26T03:00:00Z')
const dinner = [{ label: 'Dinner', first: '18:00', last: '21:00' }]

let config: BookingConfig
let fake: FakeStaffBookings
let qr: FakeCheckinQr
let sends: BookingMessageInput[]
let sendResult: BookingSendResult
let recorded: string[]

const normalizePhone = (raw: string) => {
  const p = parseE164Phone(raw)
  return isPhoneNormalizeError(p) ? null : p.value
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  config = {
    ...structuredClone(DEFAULT_BOOKING_CONFIG),
    mode: 'simple',
    maxPartySize: 12,
    bookingHours: { ...EMPTY_BOOKING_HOURS, weekly: { ...EMPTY_BOOKING_HOURS.weekly, thu: dinner, sat: dinner }, limits: { perSlot: 10, perMeal: null } },
  }
  fake = new FakeStaffBookings()
  qr = new FakeCheckinQr()
  sends = []
  recorded = []
  sendResult = { delivered: true, via: 'template' }
  const room = new FakeBookingRoom(() => fake.rows)
  let n = 0
  world.staff = {
    store: fake,
    settings: {
      getConfig: async () => config,
      getRestaurant: async () => ({ name: 'Walk Test Kitchen', logoUrl: null, whatsappNumber: null }),
      getCampaignBookingUrl: async () => null,
    },
    room,
    members: { findMemberId: async (rid, phone) => (rid === A && phone === '+85291234567' ? MEMBER : null) },
    sender: { send: async (input) => (sends.push(input), sendResult) },
    qr,
    normalizePhone,
    recordMessage: async (id, _rid, status) => void recorded.push(`${id}:${status}`),
    newCodes: () => [`K7Q2M${'XYZ'[n++ % 3]}`, 'H4PN8R'],
    now: () => NOW,
  }
  world.checkin = { store: fake, settings: { getConfig: async () => config }, now: () => NOW }
  as('staff')
})

function as(role: string, restaurantId = A) {
  vi.mocked(getTenantContext).mockResolvedValue({ userId: STAFF, restaurantId, role, tenantStatus: 'active' })
}

const url = 'http://localhost/api/dashboard/bookings'
const json = (method: string, body: unknown) => new NextRequest(url, { method, body: JSON.stringify(body) })
const ctx = (id: string) => ({ params: Promise.resolve({ id }) })
const form = { phone: '9123 4567', name: 'Chan Tai Man', partySize: 4, date: '2026-11-28', time: '19:00', notes: 'window seat' }
const create = (body: unknown = form) => createRoute(json('POST', body))
const edit = (id: string, body: unknown) => editRoute(json('PATCH', body), ctx(id))
const cancel = (id: string, body: unknown) => cancelRoute(json('POST', body), ctx(id))
const seed = (extra: Partial<StaffRow> = {}) => {
  const row = staffRow({ restaurantId: A, ...extra })
  fake.rows.push(row)
  return row
}
const editBody = (row: StaffRow, patch: Record<string, unknown> = {}) => ({
  phone: row.phone, name: row.name, partySize: row.partySize, date: row.bookingDate, time: row.bookingTime, notes: row.notes,
  notify: true, expectedVersion: row.editVersion, ...patch,
})

describe('POST /api/dashboard/bookings — staff create (S1)', () => {
  it('AC-1: confirmed, source staff, created by the user, with a code; the diner gets the confirmation with code + QR', async () => {
    const res = await create()
    expect(res.status).toBe(201)
    const { booking, message } = await res.json()
    expect(booking).toMatchObject({ status: 'confirmed', source: 'staff', createdBy: STAFF, phone: '+85291234567', checkinCode: 'K7Q2MX', notifyDiner: true })
    expect(message).toBe('delivered')
    expect(sends).toHaveLength(1)
    expect(sends[0]).toMatchObject({ kind: 'confirmed', phone: '+85291234567', details: { checkinCode: 'K7Q2MX', partySize: 4 }, image: qr.url })
    expect(JSON.stringify(sends[0])).not.toContain('window seat')
    expect(fake.events).toEqual([{ restaurantId: A, type: 'booking.staff_created', actor: STAFF, data: { bookingId: booking.id } }])
  })

  it('AC-2 / AC-19: Notify off → no message, no reminder flag, but still a code', async () => {
    const { booking, message } = await (await create({ ...form, notify: false })).json()
    expect(message).toBe('none')
    expect(sends).toHaveLength(0)
    expect(booking).toMatchObject({ notifyDiner: false, checkinCode: 'K7Q2MX' })
  })

  it('AC-3: a broken rule → 409 rules with the list; nothing written; override books anyway and records the rules', async () => {
    const res = await create({ ...form, time: '22:00' })
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'rules', rules: [{ code: 'outside_hours' }] })
    expect(fake.rows).toHaveLength(0)
    const ok = await create({ ...form, time: '22:00', override: true })
    expect(ok.status).toBe(201)
    expect(fake.events[0].data).toMatchObject({ brokenRules: ['outside_hours'] })
  })

  it('AC-3: a full slot shows the guest numbers', async () => {
    seed({ partySize: 8, bookingTime: '19:00' })
    const res = await create()
    expect(await res.json()).toEqual({ error: 'rules', rules: [{ code: 'slot_full', time: '19:00', guests: 8, limit: 10 }] })
  })

  it('AC-4: field errors are 400 and never overridable', async () => {
    const res = await create({ ...form, phone: 'abc', partySize: 13, override: true })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'invalid', fields: { phone: 'invalid', partySize: 'above_max' } })
    expect(fake.rows).toHaveLength(0)
  })

  it('AC-5 / R17: an existing member of this restaurant is linked by phone; an unknown phone creates no member', async () => {
    expect((await (await create()).json()).booking.memberId).toBe(MEMBER)
    expect((await (await create({ ...form, phone: '6123 4567' })).json()).booking.memberId).toBeNull()
  })

  it('R4: status, source, member, code and restaurant in the body are ignored', async () => {
    const { booking } = await (await create({ ...form, status: 'cancelled', source: 'agent', memberId: 'm-x', checkinCode: 'AAAAA2', restaurantId: B })).json()
    expect(booking).toMatchObject({ status: 'confirmed', source: 'staff', memberId: MEMBER, checkinCode: 'K7Q2MX', restaurantId: A })
  })

  it('R8: a code taken in this restaurant tries the next one', async () => {
    seed({ checkinCode: 'K7Q2MX' })
    world.staff!.newCodes = () => ['K7Q2MX', 'H4PN8R']
    expect((await (await create({ ...form, time: '20:00' })).json()).booking.checkinCode).toBe('H4PN8R')
  })

  it('R13: a failed status write logs the booking id only, never name, phone, notes or code', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    world.staff!.recordMessage = async () => { throw new Error('write failed for +85291234567 Chan Tai Man K7Q2MX') }
    expect((await create()).status).toBe(201)
    const text = JSON.stringify(logged.mock.calls)
    expect(text).toContain('[StaffBooking]')
    for (const secret of ['91234567', 'Chan', 'K7Q2MX', 'window seat']) expect(text).not.toContain(secret)
  })

  it('a not-delivered confirmation is stored on the row and reported', async () => {
    sendResult = { delivered: false, reason: 'outside_window' }
    const { booking, message } = await (await create()).json()
    expect(message).toBe('not_delivered')
    expect(booking.decisionMessageStatus).toBe('not_delivered')
    expect(recorded).toEqual([`${booking.id}:not_delivered`])
  })
})

describe('PATCH /api/dashboard/bookings/[id] — staff edit (S2)', () => {
  it('AC-6: changes the fields, keeps status, source and code; changed fields (no values) in the events row; diner told', async () => {
    const row = seed({ source: 'agent', reminderSentAt: '2026-11-26T00:00:00Z' })
    const res = await edit(row.id, editBody(row, { partySize: 6, time: '20:00', name: 'Chan T M' }))
    expect(res.status).toBe(200)
    const { booking, message } = await res.json()
    expect(booking).toMatchObject({ partySize: 6, bookingTime: '20:00', status: 'confirmed', source: 'agent', checkinCode: 'K7Q2MX' })
    expect(message).toBe('delivered')
    expect(sends[0]).toMatchObject({ kind: 'changed', details: { time: '20:00', partySize: 6 } })
    expect(fake.events[0]).toMatchObject({ type: 'booking.staff_edited', data: { bookingId: row.id, changed: ['name', 'partySize', 'time'] } })
    expect(JSON.stringify(fake.events)).not.toContain('Chan T M')
  })

  it('AC-7: a moved slot makes the reminder due again; a name-only edit does not and sends nothing', async () => {
    const row = seed({ reminderSentAt: '2026-11-26T00:00:00Z' })
    const nameOnly = await (await edit(row.id, editBody(row, { name: 'New Name' }))).json()
    expect(nameOnly.message).toBe('none')
    expect(fake.rows[0].reminderSentAt).toBe('2026-11-26T00:00:00Z')
    expect(sends).toHaveLength(0)
    expect((await edit(row.id, editBody(fake.rows[0], { date: '2026-12-05' }))).status).toBe(200)
    expect(fake.rows[0].reminderSentAt).toBeNull()
  })

  it('AC-6: Notify off on an edit → no message', async () => {
    const row = seed()
    expect((await (await edit(row.id, editBody(row, { partySize: 3, notify: false }))).json()).message).toBe('none')
    expect(sends).toHaveLength(0)
  })

  it('AC-8: the booking is not counted against itself; a real overflow asks', async () => {
    const row = seed({ partySize: 8 })
    expect((await edit(row.id, editBody(row, { partySize: 10 }))).status).toBe(200)
    seed({ partySize: 2 })
    const res = await edit(row.id, editBody(fake.rows[0], { partySize: 9 }))
    expect(await res.json()).toEqual({ error: 'rules', rules: [{ code: 'slot_full', time: '19:00', guests: 2, limit: 10 }] })
  })

  it('AC-9: a new phone re-resolves the member', async () => {
    const row = seed({ phone: '+85261234567', memberId: null })
    expect((await (await edit(row.id, editBody(row, { phone: '9123 4567' }))).json()).booking.memberId).toBe(MEMBER)
  })

  it('AC-10 / R5: an original with an open change request → 409 open_change, nothing written', async () => {
    const row = seed()
    seed({ status: 'pending', replacesBookingId: row.id, bookingTime: '20:00' })
    const res = await edit(row.id, editBody(row, { partySize: 3 }))
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'open_change' })
    expect(fake.writes).toEqual([])
  })

  it('AC-11 / R3: a stale form → 409 changed with the current status; nothing written or sent', async () => {
    const row = seed()
    const loaded = editBody(row, { partySize: 3 })
    fake.write(row.id, { notes: 'another staff member' })
    const res = await edit(row.id, loaded)
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'changed', status: 'confirmed' })
    expect(fake.rows[0].partySize).toBe(2)
    expect(sends).toHaveLength(0)
  })

  it('AC-11: a cancelled or declined booking cannot be edited', async () => {
    const row = seed({ status: 'cancelled' })
    expect(await (await edit(row.id, editBody(row))).json()).toEqual({ error: 'changed', status: 'cancelled' })
  })

  it('a pending booking stays pending after an edit', async () => {
    const row = seed({ status: 'pending', checkinCode: null })
    expect((await (await edit(row.id, editBody(row, { partySize: 3 }))).json()).booking.status).toBe('pending')
  })

  it('R11: a second staff message within 5 minutes is skipped (throttled), the edit is saved', async () => {
    const row = seed()
    await edit(row.id, editBody(row, { partySize: 3 }))
    const second = await (await edit(row.id, editBody(fake.rows[0], { partySize: 4 }))).json()
    expect(second.message).toBe('throttled')
    expect(second.booking.partySize).toBe(4)
    expect(sends).toHaveLength(1)
  })

  it('expectedVersion is required on an edit', async () => {
    const row = seed()
    const body: Record<string, unknown> = editBody(row)
    delete body.expectedVersion
    expect((await edit(row.id, body)).status).toBe(400)
  })

  it('review R8: a changed message that is not delivered never overwrites the delivered confirmation badge; staff still hear it', async () => {
    const row = seed({ decisionMessageStatus: 'delivered' })
    sendResult = { delivered: false, reason: 'outside_window' }
    const { booking, message } = await (await edit(row.id, editBody(row, { partySize: 3 }))).json()
    expect(message).toBe('not_delivered')
    expect(booking.decisionMessageStatus).toBe('delivered')
    expect(recorded).toEqual([])
    expect(fake.rows[0].decisionMessageStatus).toBe('delivered')
  })
})

describe('POST /api/dashboard/bookings/[id]/cancel — staff cancel (S3)', () => {
  it('AC-12: soft cancel by staff with who; QR file deleted; diner told; events row', async () => {
    const row = seed({ source: 'chat' })
    const res = await cancel(row.id, { expectedVersion: row.editVersion, notify: true })
    expect(res.status).toBe(200)
    expect(fake.rows[0]).toMatchObject({ status: 'cancelled', cancelledBy: 'staff', cancelledByUser: STAFF })
    expect(qr.removed).toEqual([row.id])
    expect(sends[0]).toMatchObject({ kind: 'cancelled', details: { date: '2026-11-28', time: '19:00' } })
    expect(fake.events[0]).toMatchObject({ type: 'booking.staff_cancelled', data: { bookingId: row.id } })
  })

  it('AC-12: Notify off → no message', async () => {
    const row = seed()
    expect((await (await cancel(row.id, { expectedVersion: row.editVersion, notify: false })).json()).message).toBe('none')
    expect(sends).toHaveLength(0)
  })

  it.each(['cancelled', 'declined', 'no_show', 'pending'] as const)('AC-13: a %s booking → 409 changed, nothing written', async (status) => {
    const row = seed({ status })
    const res = await cancel(row.id, { expectedVersion: row.editVersion })
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'changed', status })
    expect(fake.writes).toEqual([])
  })

  it('AC-13: changed by someone else since the dialog opened → 409, nothing sent', async () => {
    const row = seed()
    const loaded = { expectedVersion: row.editVersion }
    fake.write(row.id, { partySize: 5 })
    expect((await cancel(row.id, loaded)).status).toBe(409)
    expect(fake.rows[0].status).toBe('confirmed')
    expect(sends).toHaveLength(0)
  })

  it('an open change request → 409 open_change', async () => {
    const row = seed()
    seed({ status: 'pending', replacesBookingId: row.id })
    expect(await (await cancel(row.id, { expectedVersion: row.editVersion })).json()).toEqual({ error: 'open_change' })
  })

  it('review R8: a cancelled message that is not delivered leaves the confirmation badge as it was', async () => {
    const row = seed({ decisionMessageStatus: 'delivered' })
    sendResult = { delivered: false, reason: 'outside_window' }
    const { booking, message } = await (await cancel(row.id, { expectedVersion: row.editVersion, notify: true })).json()
    expect(message).toBe('not_delivered')
    expect(booking.decisionMessageStatus).toBe('delivered')
    expect(recorded).toEqual([])
  })

  it('no hard delete: there is no DELETE handler on the booking', async () => {
    const mod = await import('../[id]/route')
    expect('DELETE' in mod).toBe(false)
  })
})

describe('review R1: only a real change makes the form stale (spec AC-11, threat R3)', () => {
  // Background writes bump updated_at (082 trigger) but never edit_version (095 trigger).
  const background: Array<[string, Partial<StaffRow>]> = [
    ['the reminder claim', { reminderSentAt: '2026-11-26T02:00:00Z' }],
    ['the QR path claim', { checkinQrPath: 'AbCdEfGhIjKlMnOpQrStUvWx.png' }],
    ['the decision message status', { decisionMessageStatus: 'not_delivered' }],
    ['the staff message claim', { lastStaffMessageAt: '2026-11-26T02:00:00Z' }],
    ['a check-in', { checkedInAt: '2026-11-26T02:00:00Z' }],
  ]

  it.each(background)('after %s, the loaded edit form still saves', async (_what, patch) => {
    const row = seed()
    const loaded = editBody(row, { partySize: 3 })
    fake.write(row.id, patch)
    const res = await edit(row.id, loaded)
    expect(res.status).toBe(200)
    expect(fake.rows[0].partySize).toBe(3)
  })

  it.each(background)('after %s, the loaded cancel dialog still cancels', async (_what, patch) => {
    const row = seed()
    const loaded = { expectedVersion: row.editVersion, notify: true }
    fake.write(row.id, patch)
    expect((await cancel(row.id, loaded)).status).toBe(200)
    expect(fake.rows[0].status).toBe('cancelled')
  })

  const realChanges: Array<[string, (row: StaffRow) => void, unknown]> = [
    ['another staff member edits the party', (row) => fake.write(row.id, { partySize: 5 }), { error: 'changed', status: 'confirmed' }],
    ['the diner AI cancels', (row) => fake.write(row.id, { status: 'cancelled', cancelledBy: 'diner_ai' }), { error: 'changed', status: 'cancelled' }],
    ['the diner AI opens a change request', (row) => void seed({ status: 'pending', replacesBookingId: row.id, bookingTime: '20:00' }), { error: 'open_change' }],
  ]

  it.each(realChanges)('when %s, edit and cancel answer 409, write nothing and send nothing', async (_what, change, answer) => {
    const row = seed()
    const loadedEdit = editBody(row, { partySize: 3 })
    const loadedCancel = { expectedVersion: row.editVersion, notify: true }
    change(row)
    const before = JSON.stringify(fake.rows)
    const edited = await edit(row.id, loadedEdit)
    const cancelled = await cancel(row.id, loadedCancel)
    expect([edited.status, cancelled.status]).toEqual([409, 409])
    expect(await edited.json()).toEqual(answer)
    expect(await cancelled.json()).toEqual(answer)
    expect(JSON.stringify(fake.rows)).toBe(before)
    expect(fake.events).toEqual([])
    expect(sends).toHaveLength(0)
  })
})

describe('who may call them (R1, R2, R6)', () => {
  const calls = (id: string) => [
    () => create(),
    () => edit(id, editBody(fake.rows[0])),
    () => cancel(id, { expectedVersion: fake.rows[0].editVersion }),
    () => arrivedRoute(new Request(url), ctx(id)),
    () => undoRoute(new Request(url), ctx(id)),
  ]

  it('R1: no session → 401 on every staff route', async () => {
    const row = seed()
    vi.mocked(getTenantContext).mockRejectedValue(new AuthError('Unauthorized', 401))
    for (const call of [...calls(row.id), () => todayRoute(), () => byCodeRoute(new Request(url), { params: Promise.resolve({ code: 'K7Q2MX' }) })]) {
      expect((await call()).status).toBe(401)
    }
    expect(fake.writes).toEqual([])
  })

  it('R1: a role outside admin/staff → 403, nothing written', async () => {
    const row = seed()
    as('viewer')
    for (const call of [...calls(row.id), () => todayRoute()]) expect((await call()).status).toBe(403)
    expect(fake.writes).toEqual([])
  })

  it('admin may call them too', async () => {
    as('admin')
    expect((await create()).status).toBe(201)
  })

  it('R2: another restaurant\'s booking id → 404 on edit, cancel and check-in; untouched', async () => {
    const other = staffRow({ restaurantId: B, bookingDate: '2026-11-26' })
    fake.rows.push(other)
    expect((await edit(other.id, editBody(other, { partySize: 3 }))).status).toBe(404)
    expect((await cancel(other.id, { expectedVersion: other.editVersion })).status).toBe(404)
    expect((await arrivedRoute(new Request(url), ctx(other.id))).status).toBe(404)
    expect(fake.rows[0]).toMatchObject({ partySize: 2, status: 'confirmed', checkedInAt: null })
  })

  it('a malformed id → 404', async () => {
    expect((await edit('not-a-uuid', {})).status).toBe(404)
  })

  it('AC-16 / R6: mode off → 409 booking_off on every staff write; nothing written', async () => {
    const row = seed({ bookingDate: '2026-11-26' })
    config.mode = 'off'
    for (const call of calls(row.id)) {
      const res = await call()
      expect(res.status).toBe(409)
      expect(await res.json()).toMatchObject({ error: 'booking_off' })
    }
    expect(fake.writes).toEqual([])
  })

  it('AC-16: mode external allows staff writes', async () => {
    config.mode = 'external'
    expect((await create()).status).toBe(201)
  })
})

describe('Today and check-in (S7)', () => {
  const arrive = (id: string) => arrivedRoute(new Request(url), ctx(id))
  const undo = (id: string) => undoRoute(new Request(url), ctx(id))
  const byCode = (code: string) => byCodeRoute(new Request(url), { params: Promise.resolve({ code }) })

  it('R12: today\'s pending, confirmed and no-show bookings of this restaurant, by time, with the creator\'s name', async () => {
    seed({ bookingDate: '2026-11-26', bookingTime: '20:00', source: 'staff', createdBy: STAFF })
    seed({ bookingDate: '2026-11-26', bookingTime: '18:00', status: 'pending', checkinCode: null })
    seed({ bookingDate: '2026-11-26', status: 'cancelled' })
    seed({ bookingDate: '2026-11-27' })
    fake.rows.push(staffRow({ restaurantId: B, bookingDate: '2026-11-26' }))
    const body = await (await todayRoute()).json()
    expect(body).toMatchObject({ date: '2026-11-26', truncated: false })
    expect(body.bookings.map((b: { bookingTime: string }) => b.bookingTime)).toEqual(['18:00', '20:00'])
    expect(body.bookings[1].createdByName).toBe('Mandy')
  })

  it('R12: the list is capped and says so', async () => {
    for (let i = 0; i < 301; i++) seed({ bookingDate: '2026-11-26', checkinCode: null })
    const body = await (await todayRoute()).json()
    expect(body.bookings).toHaveLength(300)
    expect(body.truncated).toBe(true)
  })

  it('AC-22: Arrived on today\'s confirmed booking stores who and when (status stays confirmed); Undo clears it', async () => {
    const row = seed({ bookingDate: '2026-11-26' })
    const res = await arrive(row.id)
    expect(res.status).toBe(200)
    expect(fake.rows[0]).toMatchObject({ status: 'confirmed', checkedInAt: NOW.toISOString(), checkedInBy: STAFF })
    expect((await undo(row.id)).status).toBe(200)
    expect(fake.rows[0]).toMatchObject({ checkedInAt: null, checkedInBy: null })
    expect(fake.events.map((e) => e.type)).toEqual(['booking.checked_in', 'booking.check_in_undone'])
    expect(sends).toHaveLength(0)
  })

  it.each([
    ['not_today', { bookingDate: '2026-11-27' }],
    ['not_confirmed', { status: 'pending' as const }],
    ['already_arrived', { checkedInAt: '2026-11-26T02:00:00Z' }],
  ])('R14: Arrived is refused (%s)', async (reason, extra) => {
    const row = seed({ bookingDate: '2026-11-26', ...extra })
    const res = await arrive(row.id)
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ error: reason })
  })

  it('R14: Arrived is refused on an original with an open change', async () => {
    const row = seed({ bookingDate: '2026-11-26' })
    seed({ status: 'pending', replacesBookingId: row.id })
    expect(await (await arrive(row.id)).json()).toMatchObject({ error: 'open_change' })
  })

  it('Undo on a booking not arrived → 409 not_arrived', async () => {
    const row = seed({ bookingDate: '2026-11-26' })
    expect(await (await undo(row.id)).json()).toMatchObject({ error: 'not_arrived' })
  })

  it('AC-21: a scanned BK:<code> or typed code finds this restaurant\'s booking and says whether it is today', async () => {
    seed({ bookingDate: '2026-11-26', checkinCode: 'K7Q2MX' })
    seed({ bookingDate: '2026-11-30', checkinCode: 'H4PN8R' })
    expect(await (await byCode('BK:K7Q2MX')).json()).toMatchObject({ today: true, booking: { checkinCode: 'K7Q2MX' } })
    expect(await (await byCode('h4pn8r')).json()).toMatchObject({ today: false, booking: { bookingDate: '2026-11-30' } })
  })

  it('AC-24 / R2: another restaurant\'s code is not found, with nothing about it', async () => {
    fake.rows.push(staffRow({ restaurantId: B, checkinCode: 'B2B2B2' }))
    const res = await byCode('BK:B2B2B2')
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'not_found' })
  })

  it('R15: text that is not a code is never looked up', async () => {
    const spy = vi.spyOn(fake, 'findByCode')
    for (const raw of ['https%3A%2F%2Fevil.example', 'COUPON%3AABC', '%3Cscript%3E']) expect((await byCode(raw)).status).toBe(404)
    expect(spy).not.toHaveBeenCalled()
  })

  it('a cancelled booking\'s code is not found', async () => {
    seed({ status: 'cancelled', checkinCode: 'K7Q2MX' })
    expect((await byCode('K7Q2MX')).status).toBe(404)
  })
})
