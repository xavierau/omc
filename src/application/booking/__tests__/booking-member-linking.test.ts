// BOOK-008 AC-1 (R1, R7): a booking links to an EXISTING member of the same
// restaurant whose phone equals the booking phone, and never creates one.
// BOOK-001 page submissions link at creation (unchanged); a poppy (agent API)
// booking stays member-less while unverified and links when the diner's
// confirm code promotes it to pending. No diner, poppy or agent input reaches
// member_id. The 088 backfill's SQL is pinned in booking-member-migration-contract.test.ts
// and proven on a scratch DB (AC-6).
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { FakeBookingRequests, FakeBookingSender, FakeBookingSettings, FakeBookingTokens } from '@/test-utils/fake-booking'
import { FakeMemberDirectory } from '@/test-utils/fake-booking-member'
import { FakeRateLimiter } from '@/test-utils/fake-rate-limiter'
import { FakeClock } from '@/test-utils/fake-clock'
import { AGENT_BOOKING_TOOL_DECLARATIONS } from '@/application/agent/agent-booking-tools'
import { CHANGE_TOOL_DECLARATIONS } from '@/application/agent/agent-booking-change-tools'
import { submitBookingRequest, type SubmitBookingDeps } from '../submit-booking-request'
import { createAgentBooking, type CreateAgentBookingDeps } from '../create-agent-booking'
import { verifyAgentBooking, type VerifyAgentBookingDeps } from '../verify-agent-booking'
import { FakeAgentBookingStore, FakeAgentDirectory, scriptedSecrets } from './fake-agent-booking'

const A = 'rest-a'
const B = 'rest-b'
const PHONE = '+85291234567'
const OTHER = '+85298765432'
const MEMBER_UUID = '9b2c7f10-0000-4000-8000-000000000001'

describe('BOOK-001 page submission links at creation (R1, unchanged path)', () => {
  const TOKEN = 'A'.repeat(43)
  const BODY = { date: '2026-11-13', time: '19:30', partySize: 4, name: 'Test Diner', notes: null }
  let requests: FakeBookingRequests
  let members: FakeMemberDirectory
  let deps: SubmitBookingDeps

  beforeEach(() => {
    const clock = new FakeClock(new Date('2026-11-12T02:00:00.000Z'))
    const tokens = new FakeBookingTokens()
    tokens.add({ token: TOKEN, restaurantId: A, phone: PHONE, expiresAt: null })
    const settings = new FakeBookingSettings()
    settings.setConfig(A, { mode: 'simple' })
    requests = new FakeBookingRequests()
    members = new FakeMemberDirectory()
    deps = { tokens, requests, settings, members, sender: new FakeBookingSender(), limiter: new FakeRateLimiter(clock), now: () => clock.now() }
  })

  const submit = (body: unknown = BODY) => submitBookingRequest(deps, { token: TOKEN, body, clientIp: '203.0.113.7' })

  it('a member of this restaurant with the booking phone → linked', async () => {
    const id = members.add(A, PHONE)
    expect((await submit()).ok).toBe(true)
    expect(requests.rows[0].memberId).toBe(id)
  })

  it('no member with that phone → null, and no member is created', async () => {
    members.add(A, OTHER)
    await submit()
    expect(requests.rows[0].memberId).toBeNull()
    expect(members.rows).toHaveLength(1)
    expect(members.calls).toEqual(['findMemberId'])
  })

  it("another tenant's member with the same phone → not linked", async () => {
    members.add(B, PHONE)
    await submit()
    expect(requests.rows[0].memberId).toBeNull()
  })

  it('R7: a member id in the diner body never reaches member_id (the submission is refused, nothing stored)', async () => {
    const result = await submit({ ...BODY, memberId: MEMBER_UUID, member_id: MEMBER_UUID })
    expect(result.ok).toBe(false)
    expect(requests.rows).toEqual([])
  })
})

describe('poppy (agent API) booking links at verification only (R1, R7)', () => {
  const PID = 'A'.repeat(32)
  const BODY = { date: '2026-11-20', time: '19:30', party_size: 4, name: 'Test Diner', phone: PHONE }
  let clock: FakeClock
  let store: FakeAgentBookingStore
  let members: FakeMemberDirectory
  let sender: FakeBookingSender
  let createDeps: CreateAgentBookingDeps
  let verifyDeps: VerifyAgentBookingDeps

  beforeEach(() => {
    clock = new FakeClock(new Date('2026-11-19T02:00:00.000Z'))
    store = new FakeAgentBookingStore()
    store.createdAt = () => clock.now()
    const directory = new FakeAgentDirectory()
    const settings = new FakeBookingSettings()
    settings.configs.set(A, directory.add(A, PID))
    settings.restaurants.set(A, { name: 'Cafe A', logoUrl: null, whatsappNumber: '+85230001111' })
    members = new FakeMemberDirectory()
    sender = new FakeBookingSender()
    createDeps = {
      directory, store, settings, limiter: new FakeRateLimiter(clock), secrets: scriptedSecrets(['K7PX3M']),
      privacyUrl: 'https://p', now: () => clock.now(),
    }
    verifyDeps = { store, members, settings, sender, sendText: async () => {}, privacyUrl: 'https://p', now: () => clock.now() }
  })

  async function create(body: Record<string, unknown> = BODY) {
    const result = await createAgentBooking(createDeps, { publicId: PID, body, clientIp: '1.1.1.1', idempotencyKey: null })
    if (!result.ok || result.kind !== 'awaiting_confirmation') throw new Error('create failed')
    return result.body
  }

  const verify = (code: string, phone = PHONE) =>
    verifyAgentBooking(verifyDeps, { restaurantId: A, phone, text: `Confirm ${code}`, wamid: 'wamid.9' })

  it('unverified → member_id null even when a member has that phone; the promotion links it', async () => {
    const id = members.add(A, PHONE)
    const created = await create()
    expect(store.rows[0]).toMatchObject({ status: 'unverified', memberId: null })
    expect(members.calls).toEqual([])

    expect(await verify(created.confirm_code)).toEqual({ handled: true })
    expect(store.rows[0]).toMatchObject({ status: 'pending', memberId: id })
    // The "received" acknowledgement still goes to the booking phone.
    expect(sender.sent.map((m) => [m.kind, m.phone])).toEqual([['received', PHONE]])
  })

  it('no member with that phone → stays null after promotion, and no member is created', async () => {
    const created = await create()
    await verify(created.confirm_code)
    expect(store.rows[0]).toMatchObject({ status: 'pending', memberId: null })
    expect(members.rows).toEqual([])
    expect(members.calls).toEqual(['findMemberId'])
    expect(store.calls).not.toContain('linkMember')
  })

  it("another tenant's member with the same phone → not linked", async () => {
    members.add(B, PHONE)
    const created = await create()
    await verify(created.confirm_code)
    expect(store.rows[0].memberId).toBeNull()
  })

  it('a code that promotes nothing (wrong sender) links nothing', async () => {
    members.add(A, OTHER)
    const created = await create()
    expect(await verify(created.confirm_code, OTHER)).toEqual({ handled: false })
    expect(store.rows[0]).toMatchObject({ status: 'unverified', memberId: null })
    expect(store.calls).not.toContain('linkMember')
  })

  it('a failed link is logged by error name and never costs the diner the acknowledgement', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    members.add(A, PHONE)
    store.failLinkMember = true
    const created = await create()
    expect(await verify(created.confirm_code)).toEqual({ handled: true })
    expect(store.rows[0]).toMatchObject({ status: 'pending', memberId: null })
    expect(sender.sent).toHaveLength(1)
    expect(JSON.stringify(warn.mock.calls)).not.toContain(PHONE)
    warn.mockRestore()
  })

  it('R7: a member id in the agent API body is refused as an unknown field; nothing is stored', async () => {
    for (const field of ['member_id', 'memberId']) {
      const result = await createAgentBooking(createDeps, {
        publicId: PID, body: { ...BODY, [field]: MEMBER_UUID }, clientIp: '1.1.1.1', idempotencyKey: null,
      })
      expect(result).toMatchObject({ ok: false, reason: 'invalid' })
    }
    expect(store.rows).toEqual([])
  })
})

describe('R7: the WhatsApp AI agent tools take no member parameter', () => {
  it('no booking tool declaration names a member field', () => {
    const declared = JSON.stringify({ ...AGENT_BOOKING_TOOL_DECLARATIONS, ...CHANGE_TOOL_DECLARATIONS }).toLowerCase()
    expect(declared).not.toContain('member')
  })
})
