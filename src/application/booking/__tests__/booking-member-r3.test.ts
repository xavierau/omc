// BOOK-008 AC-4 (R3): member_id never decides who is messaged or what a diner
// or agent sees. A booking made from phone A that staff relinked to member B
// (phone B): the decision message, the reminder and the sender itself all go
// to phone A; the WhatsApp agent for phone B neither lists nor can change or
// cancel it, and phone A's agent still sees it. No messaging code changed.
import { describe, it, expect, vi } from 'vitest'
import { FakeBookingRequests, FakeBookingSender, FakeBookingSettings } from '@/test-utils/fake-booking'
import { FakeBookingCronStore, cronBooking } from '@/test-utils/fake-booking-cron'
import { createAgentToolExecutor } from '@/application/agent/agent-tools'
import { AGENT_TOOL_NAMES, DEFAULT_DISCLOSURE_TEXT } from '@/domain/value-objects/agent-config'
import { FakeAgentStore, FakeClock, fakeBookingWorld, fakeToolData } from '@/application/__tests__/agent-fakes'
import { decideBookingRequest } from '../decide-booking-request'
import { sendBookingReminders } from '../send-booking-reminders'
import { createBookingMessageSender, type BookingSenderDeps } from '../send-booking-message'

const R = 'rest-a'
const PHONE_A = '+85291234567'
const PHONE_B = '+85298887777'
const MEMBER_B = 'member-b'

describe('R3: messages go to the booking phone, not the linked member', () => {
  it('a staff decision on a booking relinked to member B is sent to the booking phone', async () => {
    const requests = new FakeBookingRequests()
    const booking = await requests.insert({
      restaurantId: R, memberId: MEMBER_B, phone: PHONE_A, name: 'Test Diner', partySize: 2, bookingDate: '2026-11-25',
      bookingTime: '19:30', notes: null, source: 'chat', campaignId: null, token: 'tok-r3',
    })
    const sender = new FakeBookingSender()
    const result = await decideBookingRequest(
      { requests, settings: new FakeBookingSettings(), sender, now: () => new Date('2026-11-20T03:00:00Z') },
      { restaurantId: R, userId: 'staff-1', bookingId: booking.id, decision: 'confirmed' }
    )
    expect(result).toMatchObject({ ok: true })
    expect(sender.sent.map((m) => [m.kind, m.phone])).toEqual([['confirmed', PHONE_A]])
  })

  it('the reminder of a booking relinked to member B is sent to the booking phone', async () => {
    const store = new FakeBookingCronStore([cronBooking({ phone: PHONE_A, memberId: MEMBER_B })])
    const sender = new FakeBookingSender()
    await sendBookingReminders({ store, sender, settings: new FakeBookingSettings(), now: () => new Date('2026-11-20T09:00:00.000Z') })
    expect(sender.sent.map((m) => [m.kind, m.phone])).toEqual([['reminder', PHONE_A]])
  })

  it('the sender addresses, picks the language and checks the window by the phone it is given, whatever memberId says', async () => {
    const deps = {
      getConfig: vi.fn(async () => ({ ...(await new FakeBookingSettings().getConfig(R)), mode: 'simple' })),
      findTemplates: vi.fn(async () => []),
      promoteCandidate: vi.fn(),
      getPhoneNumberId: vi.fn().mockResolvedValue('pn-1'),
      isWindowOpen: vi.fn().mockResolvedValue(true),
      getLanguage: vi.fn().mockResolvedValue('en'),
      sendTemplate: vi.fn(),
      sendText: vi.fn().mockResolvedValue({ ok: true, kapsoMessageId: 'w1', raw: null }),
    } as unknown as BookingSenderDeps
    const result = await createBookingMessageSender(deps).send({
      restaurantId: R, phone: PHONE_A, memberId: MEMBER_B, kind: 'confirmed',
      details: { restaurantName: 'Cafe A', name: 'Test Diner', date: '2026-11-25', time: '19:30', partySize: 2 },
    })
    expect(result).toEqual({ delivered: true, via: 'text' })
    expect(deps.getLanguage).toHaveBeenCalledWith(R, PHONE_A)
    expect(deps.isWindowOpen).toHaveBeenCalledWith(R, PHONE_A)
    expect(vi.mocked(deps.sendText).mock.calls[0][1]).toBe(PHONE_A)
  })
})

describe('R3: the agent sees bookings by phone, never by member', () => {
  async function setup() {
    const clock = new FakeClock()
    const store = new FakeAgentStore(clock)
    const world = fakeBookingWorld(clock)
    world.settings.setConfig(R, { mode: 'simple', maxPartySize: 8 })
    world.settings.restaurants.set(R, { name: 'Cafe A', logoUrl: null, whatsappNumber: null })
    // Booked from phone A, relinked by staff to member B (phone B).
    const relinked = await world.requests.insert({
      restaurantId: R, memberId: MEMBER_B, phone: PHONE_A, name: 'Test Diner', partySize: 4, bookingDate: '2026-11-25',
      bookingTime: '19:30', notes: null, source: 'chat', campaignId: null, token: 'tok-relinked',
    })
    world.memberIds.set(`${R}|${PHONE_B}`, MEMBER_B)

    async function job(phone: string) {
      clock.advance(60_000)
      const key = { restaurantId: R, phone }
      const row = store.seed({ restaurant_id: R, phone, role: 'user', text: 'msg' })
      const { getConfig, ...ports } = world.deps
      return createAgentToolExecutor({
        key, enabledTools: [...AGENT_TOOL_NAMES], handoffSilenceHours: 12, now: clock.now, data: fakeToolData(), silences: store,
        agentMode: 'auto',
        booking: {
          ...ports, config: await getConfig(R), inboundCreatedAt: () => store.userMessageCreatedAt(key, row.id),
          proposalOwner: `run-${row.id}`, disclosureText: DEFAULT_DISCLOSURE_TEXT,
        },
      })
    }
    return { world, relinked, job }
  }

  it("member B's phone does not list it and cannot change or cancel it", async () => {
    const { world, relinked, job } = await setup()
    const exec = await job(PHONE_B)
    expect(await exec('list_my_bookings', {})).toEqual({ bookings: [] })
    const ref = relinked.id.slice(0, 8)
    expect(await exec('propose_booking_cancel', { bookingRef: ref })).toMatchObject({ error: 'not_found' })
    expect(await exec('propose_booking_change', { bookingRef: ref, time: '20:00' })).toMatchObject({ error: 'not_found' })
    expect(world.requests.queries.every((q) => q.includes(`phone=${PHONE_B}`))).toBe(true)
    expect(world.requests.rows.find((r) => r.id === relinked.id)?.status).toBe('pending')
  })

  it('the booking phone still lists it', async () => {
    const { relinked, job } = await setup()
    const out = (await (await job(PHONE_A))('list_my_bookings', {})) as { bookings: Array<{ ref: string }> }
    expect(out.bookings.map((b) => b.ref)).toEqual([relinked.id.slice(0, 8)])
  })
})
