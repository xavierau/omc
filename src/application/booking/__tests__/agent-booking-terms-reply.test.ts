// BOOK-009 W4 (spec AC-13): after the diner sends the PAP confirm code, the
// free-form reply (collection statement) also carries the booking terms the
// diner accepted. Without terms it is exactly today's text.
import { describe, it, expect, beforeEach } from 'vitest'
import { FakeBookingSender, FakeBookingSettings } from '@/test-utils/fake-booking'
import { FakeRateLimiter } from '@/test-utils/fake-rate-limiter'
import { FakeClock } from '@/test-utils/fake-clock'
import { EMPTY_BOOKING_HOURS, type BookingHours } from '@/domain/value-objects/booking-hours'
import { buildCollectionStatement, collectionStatementText } from '@/domain/services/poppy-documents'
import { createAgentBooking } from '../create-agent-booking'
import { verifyAgentBooking } from '../verify-agent-booking'
import { FakeAgentBookingStore, FakeAgentDirectory, scriptedSecrets } from './fake-agent-booking'

const R = 'rest-a'
const PID = 'A'.repeat(32)
const PHONE = '+85291234567'
const daily = [{ first: '18:00', last: '21:30' }]
const HOURS: BookingHours = {
  ...EMPTY_BOOKING_HOURS,
  weekly: { mon: daily, tue: daily, wed: daily, thu: daily, fri: daily, sat: daily, sun: daily },
  terms: { zh_hk: '訂座保留 15 分鐘。', en: 'Tables are held for 15 minutes.' },
}
const STATEMENT = collectionStatementText(buildCollectionStatement('Cafe A', 'https://p'))

let clock: FakeClock
let store: FakeAgentBookingStore
let settings: FakeBookingSettings
let directory: FakeAgentDirectory
let texts: string[]

function tenant(bookingHours: BookingHours | null) {
  settings.configs.set(R, directory.add(R, PID, { bookingHours }))
}

beforeEach(() => {
  clock = new FakeClock(new Date('2026-11-19T02:00:00.000Z'))
  store = new FakeAgentBookingStore()
  store.createdAt = () => clock.now()
  directory = new FakeAgentDirectory()
  settings = new FakeBookingSettings()
  settings.restaurants.set(R, { name: 'Cafe A', logoUrl: null, whatsappNumber: '+85230001111' })
  texts = []
})

async function createAndConfirm(body: Record<string, unknown>) {
  const created = await createAgentBooking(
    {
      directory, store, settings, limiter: new FakeRateLimiter(clock), secrets: scriptedSecrets(['K7PX3M']),
      privacyUrl: 'https://p', now: () => clock.now(),
    },
    { publicId: PID, body: { date: '2026-11-20', time: '19:00', party_size: 2, name: 'Chan', phone: PHONE, ...body }, clientIp: '1.1.1.1', idempotencyKey: null }
  )
  if (!created.ok || created.kind !== 'awaiting_confirmation') throw new Error(`create failed: ${JSON.stringify(created)}`)
  await verifyAgentBooking(
    {
      store, members: { findMemberId: async () => null }, settings, sender: new FakeBookingSender(),
      sendText: async (_r, _p, text) => void texts.push(text), privacyUrl: 'https://p', now: () => clock.now(),
    },
    { restaurantId: R, phone: PHONE, text: created.body.confirm_code, wamid: 'wamid.1' }
  )
}

describe('AC-13 confirm reply carries the accepted terms', () => {
  it('AC-13 terms set → the statement, then the terms text the diner accepted', async () => {
    tenant(HOURS)
    await createAndConfirm({ accept_terms: true })
    expect(texts).toEqual([`${STATEMENT}\n\n訂座須知 Booking terms:\n訂座保留 15 分鐘。\n\nTables are held for 15 minutes.`])
  })

  it('AC-14 no hours → exactly the collection statement, as before', async () => {
    tenant(null)
    await createAndConfirm({})
    expect(texts).toEqual([STATEMENT])
  })
})
