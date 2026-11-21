// BOOK-009 F1 (review P2-2 ruling): the PAP confirm-code step re-checks the
// booking rules NOW, before it promotes. Up to 30 minutes pass between the
// agent's POST and the diner's code, and the admin may change hours or terms
// in between. Clock: 2026-11-19T09:00Z = Thu 19 Nov 17:00 in Hong Kong.
import { describe, it, expect, beforeEach } from 'vitest'
import { FakeBookingSender, FakeBookingSettings } from '@/test-utils/fake-booking'
import { FakeRateLimiter } from '@/test-utils/fake-rate-limiter'
import { FakeClock } from '@/test-utils/fake-clock'
import { EMPTY_BOOKING_HOURS, type BookingHours } from '@/domain/value-objects/booking-hours'
import { buildCollectionStatement, collectionStatementText } from '@/domain/services/poppy-documents'
import { createAgentBooking } from '../create-agent-booking'
import { verifyAgentBooking, type VerifyAgentBookingDeps } from '../verify-agent-booking'
import { FakeAgentBookingStore, FakeAgentDirectory, scriptedSecrets } from './fake-agent-booking'

const R = 'rest-a'
const PID = 'A'.repeat(32)
const PHONE = '+85291234567'
const LINK = 'https://app.example/b/tok'
const daily = [{ first: '18:00', last: '21:00' }]
const HOURS: BookingHours = {
  ...EMPTY_BOOKING_HOURS,
  weekly: { mon: daily, tue: daily, wed: daily, thu: daily, fri: daily, sat: daily, sun: daily },
  noticeHours: 2,
}
const TERMS = { zh_hk: '訂座保留 15 分鐘。', en: 'Tables are held for 15 minutes.' }
const STATEMENT = collectionStatementText(buildCollectionStatement('Cafe A', 'https://p'))

let clock: FakeClock
let store: FakeAgentBookingStore
let settings: FakeBookingSettings
let directory: FakeAgentDirectory
let sender: FakeBookingSender
let texts: string[]

function tenant(bookingHours: BookingHours | null) {
  directory.tenants.clear()
  settings.configs.set(R, directory.add(R, PID, { bookingHours }))
}

beforeEach(() => {
  clock = new FakeClock(new Date('2026-11-19T09:00:00.000Z'))
  store = new FakeAgentBookingStore()
  store.createdAt = () => clock.now()
  directory = new FakeAgentDirectory()
  settings = new FakeBookingSettings()
  settings.restaurants.set(R, { name: 'Cafe A', logoUrl: null, whatsappNumber: '+85230001111' })
  sender = new FakeBookingSender()
  texts = []
})

async function create(body: Record<string, unknown> = {}) {
  const created = await createAgentBooking(
    {
      directory, store, settings, limiter: new FakeRateLimiter(clock), secrets: scriptedSecrets(['K7PX3M', 'Q2W3E4']),
      privacyUrl: 'https://p', now: () => clock.now(),
    },
    { publicId: PID, body: { date: '2026-11-19', time: '19:00', party_size: 2, name: 'Chan', phone: PHONE, ...body }, clientIp: '1.1.1.1', idempotencyKey: null }
  )
  if (!created.ok || created.kind !== 'awaiting_confirmation') throw new Error(`create failed: ${JSON.stringify(created)}`)
  return created.body.confirm_code
}

function confirm(code: string) {
  const deps: VerifyAgentBookingDeps = {
    store, members: { findMemberId: async () => null }, settings, sender,
    sendText: async (_r, _p, text) => void texts.push(text), bookingLink: async () => LINK,
    privacyUrl: 'https://p', now: () => clock.now(),
  }
  return verifyAgentBooking(deps, { restaurantId: R, phone: PHONE, text: code, wamid: 'wamid.1' })
}

describe('P2-2 the confirm step re-checks hours', () => {
  it('code sent after the minimum notice passed → declined "rules", not promoted, reply with alternatives and the link', async () => {
    tenant(HOURS)
    const code = await create() // 17:00 for 19:00, 2 h notice: accepted at POST
    clock.set(new Date('2026-11-19T09:25:00.000Z')) // 17:25: 19:00 is now inside the notice
    expect(await confirm(code)).toEqual({ handled: true })
    expect(store.rows[0]).toMatchObject({ status: 'declined', declineReason: 'rules', decidedBy: null, confirmCode: null })
    expect(store.calls).not.toContain('linkMember')
    expect(sender.sent).toHaveLength(0)
    expect(texts).toHaveLength(1)
    expect(texts[0]).toContain('2026-11-19 19:00')
    expect(texts[0]).toContain('仍可預訂：2026-11-19 19:30, 2026-11-19 20:00, 2026-11-19 20:30')
    expect(texts[0]).toContain(`Book again: ${LINK}`)
  })

  it('the admin closed that day between POST and code → declined "rules" with the next open day suggested', async () => {
    tenant(HOURS)
    const code = await create()
    tenant({ ...HOURS, special: [{ date: '2026-11-19', periods: [] }] })
    expect(await confirm(code)).toEqual({ handled: true })
    expect(store.rows[0].status).toBe('declined')
    expect(texts[0]).toContain('2026-11-20 19:00')
  })

  it('still bookable → promoted and acknowledged exactly as before', async () => {
    tenant(HOURS)
    const code = await create()
    expect(await confirm(code)).toEqual({ handled: true })
    expect(store.rows[0].status).toBe('pending')
    expect(sender.sent).toHaveLength(1)
    expect(texts).toEqual([STATEMENT])
  })

  it('the schedule switched off after POST → any time is fine, promoted', async () => {
    tenant(HOURS)
    const code = await create()
    tenant({ ...HOURS, scheduleEnabled: false })
    clock.set(new Date('2026-11-19T09:25:00.000Z'))
    expect(await confirm(code)).toEqual({ handled: true })
    expect(store.rows[0].status).toBe('pending')
  })
})

describe('P2-2 terms at the confirm step', () => {
  it('terms added after a no-terms POST → not promoted (stays unverified), reply asks to rebook via the agent or the link', async () => {
    tenant(HOURS)
    const code = await create()
    tenant({ ...HOURS, terms: TERMS })
    expect(await confirm(code)).toEqual({ handled: true })
    expect(store.rows[0].status).toBe('unverified')
    expect(sender.sent).toHaveLength(0)
    expect(texts).toHaveLength(1)
    expect(texts[0]).toContain('booking terms')
    expect(texts[0]).toContain(`through your agent or this link: ${LINK}`)
  })

  it('the confirmed reply carries terms only when the booking stored them', async () => {
    tenant({ ...HOURS, terms: TERMS })
    const code = await create({ accept_terms: true })
    tenant(HOURS) // terms removed after the POST: the stored acceptance is still what the diner agreed to
    await confirm(code)
    expect(store.rows[0].status).toBe('pending')
    expect(texts).toEqual([`${STATEMENT}\n\n訂座須知 Booking terms:\n${TERMS.zh_hk}\n\n${TERMS.en}`])
  })

  it('no terms on the booking and none now → the statement only (current terms are never appended)', async () => {
    tenant(HOURS)
    const code = await create()
    await confirm(code)
    expect(texts).toEqual([STATEMENT])
  })
})
