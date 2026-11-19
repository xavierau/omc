// BOOK-003 AC-4 (R31, R32, R44): an agent booking's confirm code through
// routeMessage. The code from the booking phone promotes the booking and
// sends one "received" message plus the collection statement; the same code
// from another phone, an expired code and a replayed wamid change nothing
// and today's routing runs unchanged.
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../service-window', () => ({ bumpServiceWindow: vi.fn() }))
vi.mock('@/application/restore-member-reachability', () => ({ restoreMemberReachability: vi.fn() }))
vi.mock('../optin-prompt', () => ({ maybePromptOptin: vi.fn() }))
vi.mock('../language-handler', () => ({
  maybeHandleLanguageCommand: vi.fn(async () => false),
  maybeDetectLanguageForExistingMember: vi.fn(),
}))
vi.mock('../resolve-language', () => ({ resolveLanguageForMember: vi.fn() }))
vi.mock('@/infrastructure/supabase/repositories/member-repository', () => ({ findMemberByPhone: vi.fn(async () => null) }))
vi.mock('@/infrastructure/supabase/repositories/restaurant-repository', () => ({
  getRestaurantPhoneNumberId: vi.fn(async () => 'pn-a'),
  getReplyConfig: vi.fn(),
}))
vi.mock('@/infrastructure/whatsapp/messaging', () => ({ sendCtaUrlButton: vi.fn() }))
vi.mock('../member-handlers', () => ({
  handleRedeem: vi.fn(), handleUnsubscribe: vi.fn(), handleRewards: vi.fn(), handleRewardRedeem: vi.fn(),
}))
vi.mock('../claim-handler', () => ({ handleClaim: vi.fn() }))
vi.mock('../join-and-image-handlers', () => ({ handleJoin: vi.fn(), handleReceiptImage: vi.fn(), handlePoints: vi.fn() }))
vi.mock('../contact-handler', () => ({ handleContact: vi.fn() }))
vi.mock('../contact-form-handler', () => ({ handleContactFormSubmission: vi.fn() }))
vi.mock('../my-card-handler', () => ({ handleMyCard: vi.fn() }))
vi.mock('../unknown-help-handlers', () => ({ handleUnknown: vi.fn(), handleHelp: vi.fn() }))
vi.mock('../receipt-confirmation', () => ({ handleReceiptConfirmation: vi.fn(async () => false) }))
vi.mock('../optin-confirmation', () => ({ handleOptinConfirmation: vi.fn(async () => false), handleOptinRejection: vi.fn(async () => false) }))
vi.mock('../book-handler', () => ({ handleBookCommand: vi.fn(), maybeReplyToBookingIntent: vi.fn(async () => false) }))
vi.mock('@/application/booking/booking-deps', () => ({ verifyAgentBookingDeps: vi.fn() }))

import { routeMessage } from '../handlers'
import { handleUnknown } from '../unknown-help-handlers'
import { handleReceiptConfirmation } from '../receipt-confirmation'
import { handleRedeem } from '../member-handlers'
import { verifyAgentBookingDeps } from '@/application/booking/booking-deps'
import { FakeBookingSender, FakeBookingSettings } from '@/test-utils/fake-booking'
import { FakeAgentBookingStore } from '@/application/booking/__tests__/fake-agent-booking'
import type { KapsoMessage } from '@/infrastructure/whatsapp/webhooks'

const R = 'rest-a'
const PHONE = '+85291234567'
const OTHER = '+85298765432'
const NOW = new Date('2026-11-19T02:10:00.000Z')
const CONFIRM_TEXT = '確認Cafe A訂座 Confirm my booking at Cafe A: K7PX3M'
const AGENT_ON = { enabled: true, publicId: 'P'.repeat(32), websiteHost: 'www.cafe-a.hk' }

let store: FakeAgentBookingStore
let settings: FakeBookingSettings
let sender: FakeBookingSender
let texts: Array<{ restaurantId: string; phone: string; text: string }>
let now: Date

function msg(partial: Partial<KapsoMessage>): KapsoMessage {
  return { messageId: 'wamid.1', from: PHONE, type: 'text', timestamp: '1700000000', text: CONFIRM_TEXT, ...partial } as KapsoMessage
}

async function seed(patch: { verifyExpiresAt?: string; restaurantId?: string; code?: string } = {}) {
  store.createdAt = () => new Date('2026-11-19T02:00:00.000Z')
  await store.insert({
    restaurantId: patch.restaurantId ?? R, phone: PHONE, name: 'Chan Tai Man', partySize: 4, bookingDate: '2026-11-20',
    bookingTime: '19:30', notes: null, confirmCode: patch.code ?? 'K7PX3M', verifyExpiresAt: patch.verifyExpiresAt ?? '2026-11-19T02:30:00.000Z',
    statusTokenHash: 'a'.repeat(64), idempotencyKey: null,
  })
  return store.rows[store.rows.length - 1]
}

beforeEach(() => {
  vi.clearAllMocks()
  store = new FakeAgentBookingStore()
  sender = new FakeBookingSender()
  texts = []
  now = NOW
  settings = new FakeBookingSettings()
  settings.restaurants.set(R, { name: 'Cafe A', logoUrl: null, whatsappNumber: '+85230001111' })
  settings.setConfig(R, { mode: 'simple', agentBooking: AGENT_ON })
  vi.mocked(verifyAgentBookingDeps).mockImplementation(() => ({
    store,
    settings,
    sender,
    sendText: async (restaurantId, phone, text) => void texts.push({ restaurantId, phone, text }),
    privacyUrl: 'https://ohmyclient.io/privacy-policy.html',
    now: () => now,
  }))
})

describe('BOOK-003 confirm code in routeMessage (AC-4)', () => {
  it('R31/R44: the code from the booking phone → pending, one received message, the statement, no normal routing', async () => {
    const booking = await seed()
    await routeMessage(msg({}), R)
    expect(store.rows[0]).toMatchObject({
      id: booking.id, status: 'pending', verifiedAt: NOW.toISOString(), verifiedWamid: 'wamid.1', confirmCode: null,
    })
    expect(sender.sent).toHaveLength(1)
    expect(sender.sent[0]).toMatchObject({
      restaurantId: R, phone: PHONE, kind: 'received',
      details: { restaurantName: 'Cafe A', name: 'Chan Tai Man', date: '2026-11-20', time: '19:30', partySize: 4 },
    })
    expect(texts).toHaveLength(1)
    expect(texts[0].text).toContain('只會交給Cafe A')
    expect(texts[0].text).toContain('go only to Cafe A')
    expect(texts[0].text).toContain('https://ohmyclient.io/privacy-policy.html')
    expect(handleReceiptConfirmation).not.toHaveBeenCalled()
    expect(handleUnknown).not.toHaveBeenCalled()
  })

  it('R31: matching is case-insensitive (the diner retyped it)', async () => {
    await seed()
    await routeMessage(msg({ text: 'k7px3m' }), R)
    expect(store.rows[0].status).toBe('pending')
  })

  it('R31: the same code from another phone → unchanged, nothing sent, normal routing runs', async () => {
    await seed()
    await routeMessage(msg({ from: OTHER }), R)
    expect(store.rows[0]).toMatchObject({ status: 'unverified', confirmCode: 'K7PX3M', verifiedAt: null })
    expect(sender.sent).toEqual([])
    expect(texts).toEqual([])
    expect(handleReceiptConfirmation).toHaveBeenCalled()
    expect(handleUnknown).toHaveBeenCalledWith('pn-a', OTHER, R)
  })

  it('R31: an expired code → unchanged and normal routing runs', async () => {
    await seed({ verifyExpiresAt: '2026-11-19T02:05:00.000Z' })
    await routeMessage(msg({}), R)
    expect(store.rows[0].status).toBe('unverified')
    expect(sender.sent).toEqual([])
    expect(handleUnknown).toHaveBeenCalledTimes(1)
  })

  it('R31: the code at another restaurant does not promote here', async () => {
    await seed({ restaurantId: 'rest-b' })
    await routeMessage(msg({}), R)
    expect(store.rows[0].status).toBe('unverified')
    expect(handleUnknown).toHaveBeenCalledTimes(1)
  })

  it('R32: a replayed webhook (same wamid) → one status change, one message; the replay runs normal routing', async () => {
    await seed()
    await routeMessage(msg({}), R)
    await routeMessage(msg({}), R)
    expect(store.rows[0].status).toBe('pending')
    expect(sender.sent).toHaveLength(1)
    expect(texts).toHaveLength(1)
    expect(handleUnknown).toHaveBeenCalledTimes(1)
  })

  it('R32: two concurrent deliveries promote once', async () => {
    await seed()
    await Promise.all([routeMessage(msg({}), R), routeMessage(msg({}), R)])
    expect(sender.sent).toHaveLength(1)
  })

  it('a text with no code-shaped token never touches the agent store (no extra query)', async () => {
    await routeMessage(msg({ text: 'THANKS see you tomorrow' }), R)
    expect(verifyAgentBookingDeps).not.toHaveBeenCalled()
    expect(store.calls).toEqual([])
    expect(handleUnknown).toHaveBeenCalledTimes(1)
  })

  it('a REDEEM code that looks like a confirm code still redeems when no booking matches', async () => {
    await routeMessage(msg({ text: 'REDEEM AB23CD' }), R)
    expect(store.calls).toEqual(['promote'])
    expect(handleRedeem).toHaveBeenCalledWith('pn-a', PHONE, 'AB23CD', R)
  })

  it('a failing store falls through to normal routing instead of dropping the message', async () => {
    store.promote = async () => {
      throw new Error('db down')
    }
    await seed()
    await routeMessage(msg({}), R)
    expect(handleUnknown).toHaveBeenCalledTimes(1)
  })

  it('F1 (BOOK-001 R11): three pending at this restaurant → the code promotes nothing, nothing sent, normal routing', async () => {
    for (let i = 0; i < 3; i++) store.seedPending(R, PHONE, 'chat')
    await seed()
    await routeMessage(msg({}), R)
    const agentRow = store.rows.find((r) => r.confirmCode === 'K7PX3M')
    expect(agentRow).toMatchObject({ status: 'unverified', verifiedAt: null })
    expect(store.rows.filter((r) => r.status === 'pending')).toHaveLength(3)
    expect(sender.sent).toEqual([])
    expect(texts).toEqual([])
    expect(handleUnknown).toHaveBeenCalledTimes(1)
  })

  it('F1: two codes in one text with room for one more pending → one promotion, one message', async () => {
    store.seedPending(R, PHONE, 'chat')
    store.seedPending(R, PHONE, 'agent')
    await seed({ code: 'K7PX3M' })
    await seed({ code: 'Q2W3E4' })
    await routeMessage(msg({ text: 'K7PX3M Q2W3E4' }), R)
    expect(store.rows.filter((r) => r.status === 'pending')).toHaveLength(3)
    expect(sender.sent).toHaveLength(1)
  })

  it('F1: pending at another restaurant does not block the code here', async () => {
    for (let i = 0; i < 3; i++) store.seedPending('rest-b', PHONE, 'chat')
    await seed()
    await routeMessage(msg({}), R)
    expect(store.rows.find((r) => r.verifiedWamid === 'wamid.1')).toBeDefined()
    expect(sender.sent).toHaveLength(1)
  })

  it.each([
    ['agent booking turned off', { mode: 'simple' as const, agentBooking: { ...AGENT_ON, enabled: false } }],
    ['booking mode external', { mode: 'external' as const, externalUrl: 'https://book.example', agentBooking: AGENT_ON }],
    ['booking mode off', { mode: 'off' as const, agentBooking: AGENT_ON }],
  ])('F2: %s → the code promotes nothing, nothing sent, normal routing', async (_label, config) => {
    settings.setConfig(R, config)
    await seed()
    await routeMessage(msg({}), R)
    expect(store.rows[0]).toMatchObject({ status: 'unverified', confirmCode: 'K7PX3M', verifiedAt: null })
    expect(store.calls).not.toContain('promote')
    expect(sender.sent).toEqual([])
    expect(texts).toEqual([])
    expect(handleUnknown).toHaveBeenCalledTimes(1)
  })

  it('a non-text message never runs the check', async () => {
    await routeMessage(msg({ type: 'image', text: undefined }), R)
    expect(verifyAgentBookingDeps).not.toHaveBeenCalled()
  })
})

describe('R37: the verify path logs no PII, code or token', () => {
  it('success and failure paths carry only event names, the wamid and error classes', async () => {
    const logs: unknown[] = []
    const log = (...args: unknown[]) => void logs.push(args)
    for (const level of ['log', 'info', 'warn', 'error'] as const) vi.spyOn(console, level).mockImplementation(log)
    await seed()
    await routeMessage(msg({}), R, log)
    store.promote = async () => {
      throw new Error(`db down for ${PHONE} K7PX3M`)
    }
    await routeMessage(msg({ messageId: 'wamid.2' }), R, log)
    const text = JSON.stringify(logs)
    expect(text).toContain('handler.agent_booking_verified')
    expect(text).toContain('handler.agent_booking_check_failed')
    for (const secret of [PHONE, '91234567', 'Chan Tai Man', 'K7PX3M', 'a'.repeat(64)]) expect(text).not.toContain(secret)
    vi.restoreAllMocks()
  })
})
