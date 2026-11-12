// BOOK-001 W2: inbound booking routing through routeMessage.
// W2-01 (AC-5) BOOK keywords · W2-02 (AC-8) matched routes never classify ·
// W2-03 (AC-4) free text · W2-04 (AC-6, R12) fail-open with a stubbed fetch ·
// W2-06 (R13) · W2-07 (AC-7, R17) replay · W2-08 (R8) logs.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../service-window', () => ({ bumpServiceWindow: vi.fn() }))
vi.mock('@/application/restore-member-reachability', () => ({ restoreMemberReachability: vi.fn() }))
vi.mock('../optin-prompt', () => ({ maybePromptOptin: vi.fn() }))
vi.mock('../language-handler', () => ({
  maybeHandleLanguageCommand: vi.fn(async () => false),
  maybeDetectLanguageForExistingMember: vi.fn(),
}))
vi.mock('../resolve-language', () => ({ resolveLanguageForMember: vi.fn() }))
vi.mock('@/infrastructure/supabase/repositories/member-repository', () => ({ findMemberByPhone: vi.fn() }))
vi.mock('@/infrastructure/supabase/repositories/restaurant-repository', () => ({
  getRestaurantPhoneNumberId: vi.fn(async () => 'pn-a'),
  getReplyConfig: vi.fn(),
}))
vi.mock('@/infrastructure/whatsapp/messaging', () => ({ sendCtaUrlButton: vi.fn() }))
vi.mock('../member-handlers', () => ({
  handleRedeem: vi.fn(), handleUnsubscribe: vi.fn(), handleRewards: vi.fn(), handleRewardRedeem: vi.fn(),
}))
vi.mock('../claim-handler', () => ({ handleClaim: vi.fn() }))
vi.mock('../join-and-image-handlers', () => ({
  handleJoin: vi.fn(), handleReceiptImage: vi.fn(), handlePoints: vi.fn(),
}))
vi.mock('../contact-handler', () => ({ handleContact: vi.fn() }))
vi.mock('../contact-form-handler', () => ({ handleContactFormSubmission: vi.fn() }))
vi.mock('../my-card-handler', () => ({ handleMyCard: vi.fn() }))
vi.mock('../unknown-help-handlers', () => ({ handleUnknown: vi.fn(), handleHelp: vi.fn() }))
vi.mock('../receipt-confirmation', () => ({ handleReceiptConfirmation: vi.fn() }))
vi.mock('../optin-confirmation', () => ({
  handleOptinConfirmation: vi.fn(), handleOptinRejection: vi.fn(),
}))
vi.mock('@/application/booking/inbound-booking-deps', () => ({ inboundBookingDeps: vi.fn() }))
vi.mock('@/infrastructure/supabase/client', () => ({ createServerSupabaseClient: vi.fn() }))

import { routeMessage } from '../handlers'
import { sendCtaUrlButton } from '@/infrastructure/whatsapp/messaging'
import { getReplyConfig } from '@/infrastructure/supabase/repositories/restaurant-repository'
import { findMemberByPhone } from '@/infrastructure/supabase/repositories/member-repository'
import { resolveLanguageForMember } from '../resolve-language'
import { resolveReplyConfig } from '@/domain/services/reply-config'
import { Language } from '@/domain/value-objects/language'
import { handleUnknown } from '../unknown-help-handlers'
import { handleReceiptConfirmation } from '../receipt-confirmation'
import { handleOptinConfirmation, handleOptinRejection } from '../optin-confirmation'
import { handleJoin, handleReceiptImage, handlePoints } from '../join-and-image-handlers'
import { handleClaim } from '../claim-handler'
import { handleRewards } from '../member-handlers'
import { handleContact } from '../contact-handler'
import { inboundBookingDeps } from '@/application/booking/inbound-booking-deps'
import { createServerSupabaseClient } from '@/infrastructure/supabase/client'
import { createDecisionsClassifier } from '@/infrastructure/gemini/decisions-client'
import { DEFAULT_BOOKING_CONFIG, type BookingConfig } from '@/domain/value-objects/booking-config'
import type { RouteBookingIntentDeps } from '@/application/booking/route-booking-intent'
import type { IntentClassifierPort } from '@/domain/ports/intent-classifier'
import type { KapsoMessage } from '@/infrastructure/whatsapp/webhooks'
import { FakeChatTokens, FakeClassificationStore, FakeIntentClassifier } from '@/test-utils/fake-intent-classifier'
import { okResult } from '@/test-utils/send-result'

const R = 'rest-a'
const PHONE = '+85291234567'
const APP = 'https://app.example.com'
const BOOKING_TEXT = '想訂星期五7點4位'

let config: BookingConfig
let classifier: IntentClassifierPort & { calls?: string[] }
let classifications: FakeClassificationStore
let tokens: FakeChatTokens

function msg(partial: Partial<KapsoMessage>): KapsoMessage {
  return { messageId: 'wamid.1', from: PHONE, type: 'text', timestamp: '1700000000', ...partial } as KapsoMessage
}

function useDeps() {
  vi.mocked(inboundBookingDeps).mockImplementation((log) => ({
    getConfig: async () => config,
    classifier,
    classifications,
    tokens,
    appUrl: APP,
    log,
  }) satisfies RouteBookingIntentDeps)
}

const fakeClassifier = () => classifier as FakeIntentClassifier

beforeEach(() => {
  vi.clearAllMocks()
  config = { ...DEFAULT_BOOKING_CONFIG, mode: 'simple', aiRoutingEnabled: true }
  classifier = new FakeIntentClassifier({ ok: true, label: 'booking', confidence: 0.92 })
  classifications = new FakeClassificationStore()
  tokens = new FakeChatTokens()
  useDeps()
  vi.mocked(getReplyConfig).mockResolvedValue(resolveReplyConfig({}))
  vi.mocked(findMemberByPhone).mockResolvedValue(null)
  vi.mocked(resolveLanguageForMember).mockResolvedValue(Language.ZH_HK)
  vi.mocked(sendCtaUrlButton).mockResolvedValue(okResult())
  vi.mocked(handleReceiptConfirmation).mockResolvedValue(false)
  vi.mocked(handleOptinConfirmation).mockResolvedValue(false)
  vi.mocked(handleOptinRejection).mockResolvedValue(false)
})

const ctaUrl = () => vi.mocked(sendCtaUrlButton).mock.calls[0]?.[4]

describe('W2-01 BOOK keywords (AC-5)', () => {
  it.each(['BOOK', 'book', ' Booking ', '訂位', '訂枱'])('%s in simple mode → CTA to /b/<minted token>', async (text) => {
    await routeMessage(msg({ text }), R)
    expect(tokens.mints).toEqual([{ restaurantId: R, phone: PHONE, ttlHours: 24 }])
    expect(ctaUrl()).toMatch(new RegExp(`^${APP}/b/tok1x+$`))
    expect(fakeClassifier().calls).toEqual([])
    expect(handleUnknown).not.toHaveBeenCalled()
  })

  it('reuses the live chat token on a repeat BOOK (R11)', async () => {
    tokens.live.set(`${R}|${PHONE}`, 'existing-live-token')
    await routeMessage(msg({ text: 'BOOK' }), R)
    expect(tokens.mints).toEqual([])
    expect(ctaUrl()).toBe(`${APP}/b/existing-live-token`)
  })

  it('mints with no expiry when chatLinkTtlHours is null', async () => {
    config = { ...config, chatLinkTtlHours: null }
    await routeMessage(msg({ text: 'BOOK' }), R)
    expect(tokens.mints[0].ttlHours).toBeNull()
  })

  it('external mode → CTA to the external URL, no token', async () => {
    config = { ...config, mode: 'external', externalUrl: 'https://inline.app/r/demo' }
    await routeMessage(msg({ text: '訂位' }), R)
    expect(ctaUrl()).toBe('https://inline.app/r/demo')
    expect(tokens.mints).toEqual([])
  })

  it('uses member-language copy: EN body and button for an EN member', async () => {
    vi.mocked(resolveLanguageForMember).mockResolvedValue(Language.EN)
    await routeMessage(msg({ text: 'BOOK' }), R)
    const [pn, to, body, button] = vi.mocked(sendCtaUrlButton).mock.calls[0]
    expect([pn, to]).toEqual(['pn-a', PHONE])
    expect(button).toBe('Book now')
    expect(body).toMatch(/table/i)
  })

  it('uses ZH copy for a ZH member', async () => {
    await routeMessage(msg({ text: 'BOOK' }), R)
    const [, , body, button] = vi.mocked(sendCtaUrlButton).mock.calls[0]
    expect(button).toBe('立即訂位')
    expect(body).toMatch(/訂位/)
  })

  it('mode off → exactly today: receipt check with the text, then the unknown reply', async () => {
    config = { ...config, mode: 'off' }
    await routeMessage(msg({ text: 'BOOK' }), R)
    const bookCalls = {
      receipt: vi.mocked(handleReceiptConfirmation).mock.calls,
      unknown: vi.mocked(handleUnknown).mock.calls,
    }
    vi.clearAllMocks()
    useDeps()
    vi.mocked(handleReceiptConfirmation).mockResolvedValue(false)
    await routeMessage(msg({ text: 'hello there' }), R)
    expect(bookCalls.receipt).toEqual([[{ phoneNumberId: 'pn-a', phone: PHONE, route: null, restaurantId: R, text: 'BOOK' }]])
    expect(bookCalls.unknown).toEqual(vi.mocked(handleUnknown).mock.calls)
    expect(bookCalls.unknown).toEqual([['pn-a', PHONE, R]])
    expect(sendCtaUrlButton).not.toHaveBeenCalled()
    expect(fakeClassifier().calls).toEqual([])
  })

  it('simple mode with a failed mint → the unknown reply, no classifier', async () => {
    tokens.failMint = true
    await routeMessage(msg({ text: 'BOOK' }), R)
    expect(handleUnknown).toHaveBeenCalledWith('pn-a', PHONE, R)
    expect(sendCtaUrlButton).not.toHaveBeenCalled()
    expect(fakeClassifier().calls).toEqual([])
  })
})

describe('W2-02 matched routes never reach the classifier (AC-8)', () => {
  it.each<[string, Partial<KapsoMessage>, () => unknown]>([
    ['JOIN', { text: 'JOIN' }, () => expect(handleJoin).toHaveBeenCalled()],
    ['CLAIM_x', { text: 'CLAIM_abc' }, () => expect(handleClaim).toHaveBeenCalled()],
    ['REDEEM', { text: 'REDEEM' }, () => expect(handleRewards).toHaveBeenCalled()],
    ['POINTS', { text: 'POINTS' }, () => expect(handlePoints).toHaveBeenCalled()],
    ['CONTACT', { text: 'CONTACT' }, () => expect(handleContact).toHaveBeenCalled()],
    ['receipt image', { type: 'image', imageId: 'img1' }, () => expect(handleReceiptImage).toHaveBeenCalled()],
  ])('%s → its handler, zero classifier calls', async (_, partial, handled) => {
    await routeMessage(msg(partial), R)
    handled()
    expect(fakeClassifier().calls).toEqual([])
    expect(classifications.rows).toEqual([])
  })

  it('receipt confirmation (free-text correction) → zero classifier calls', async () => {
    vi.mocked(handleReceiptConfirmation).mockResolvedValue(true)
    await routeMessage(msg({ text: '$123.40' }), R)
    expect(fakeClassifier().calls).toEqual([])
    expect(handleUnknown).not.toHaveBeenCalled()
  })

  it('opt-in YES and NO → zero classifier calls', async () => {
    vi.mocked(handleOptinConfirmation).mockResolvedValue(true)
    vi.mocked(handleOptinRejection).mockResolvedValue(true)
    await routeMessage(msg({ text: 'YES' }), R)
    await routeMessage(msg({ text: 'NO', messageId: 'wamid.2' }), R)
    expect(handleOptinConfirmation).toHaveBeenCalled()
    expect(handleOptinRejection).toHaveBeenCalled()
    expect(fakeClassifier().calls).toEqual([])
  })

  it('an unclaimed YES and a disabled POINTS fall to the unknown reply without the classifier', async () => {
    vi.mocked(getReplyConfig).mockResolvedValue(resolveReplyConfig({ features: { points: false } }))
    await routeMessage(msg({ text: 'YES' }), R)
    await routeMessage(msg({ text: 'POINTS', messageId: 'wamid.2' }), R)
    expect(handleUnknown).toHaveBeenCalledTimes(2)
    expect(fakeClassifier().calls).toEqual([])
  })
})

describe('W2-03 free text (AC-4)', () => {
  it('booking ≥ 0.7 → Book now reply, no fallback menu', async () => {
    await routeMessage(msg({ text: BOOKING_TEXT }), R)
    expect(fakeClassifier().calls).toEqual([BOOKING_TEXT])
    expect(ctaUrl()).toMatch(new RegExp(`^${APP}/b/`))
    expect(handleUnknown).not.toHaveBeenCalled()
  })

  it('external mode → Book now reply to the external URL', async () => {
    config = { ...config, mode: 'external', externalUrl: 'https://inline.app/r/demo' }
    await routeMessage(msg({ text: BOOKING_TEXT }), R)
    expect(ctaUrl()).toBe('https://inline.app/r/demo')
  })

  it.each([
    ['aiRoutingEnabled false', { aiRoutingEnabled: false }],
    ['mode off', { mode: 'off' as const }],
  ])('%s → classifier not called, fallback as today', async (_, over) => {
    config = { ...config, ...over }
    await routeMessage(msg({ text: BOOKING_TEXT }), R)
    expect(fakeClassifier().calls).toEqual([])
    expect(handleUnknown).toHaveBeenCalledWith('pn-a', PHONE, R)
    expect(sendCtaUrlButton).not.toHaveBeenCalled()
  })
})

// ---- W2-04: the real adapter over a stubbed fetch -------------------------

type FetchStub = (url: string, init: RequestInit) => Promise<Response>
let lastInit: RequestInit | undefined

function useFetch(stub: FetchStub, apiKey: string | null = 'test-key') {
  const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
    lastInit = init
    return stub(url, init)
  })
  classifier = createDecisionsClassifier({ fetchImpl: fetchImpl as unknown as typeof fetch, getApiKey: () => apiKey ?? undefined })
  return fetchImpl
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const answer = (choice: string, confidence: number) =>
  json(200, { answers: { intent: { type: 'choice', choice, probabilities: { [choice]: confidence }, confidence } } })

function expectFallback() {
  expect(handleUnknown).toHaveBeenCalledWith('pn-a', PHONE, R)
  expect(sendCtaUrlButton).not.toHaveBeenCalled()
}

describe('W2-04 fail-open through the real adapter (AC-6, R12)', () => {
  afterEach(() => vi.useRealTimers())

  it('control: booking 0.9 from the API → Book now', async () => {
    useFetch(async () => answer('booking', 0.9))
    await routeMessage(msg({ text: BOOKING_TEXT }), R)
    expect(ctaUrl()).toMatch(/\/b\//)
    expect(handleUnknown).not.toHaveBeenCalled()
  })

  it.each<[string, FetchStub]>([
    ['other label', async () => answer('other', 0.95)],
    ['booking 0.69', async () => answer('booking', 0.69)],
    ['400 safety', async () => json(400, { error: { code: 'safety', message: 'Request blocked due to safety violations' } })],
    ['500', async () => json(500, { error: { message: 'internal' } })],
    ['network error', async () => { throw new TypeError('fetch failed') }],
    ['malformed JSON', async () => new Response('{not json', { status: 200 })],
    ['missing answer', async () => json(200, { answers: {} })],
  ])('%s → today\'s fallback reply', async (_, stub) => {
    useFetch(stub)
    await routeMessage(msg({ text: BOOKING_TEXT }), R)
    expectFallback()
  })

  it('missing key → fallback without any fetch', async () => {
    const fetchImpl = useFetch(async () => answer('booking', 0.99), null)
    await routeMessage(msg({ text: BOOKING_TEXT }), R)
    expect(fetchImpl).not.toHaveBeenCalled()
    expectFallback()
  })

  it('timeout (> 2 s) → fallback', async () => {
    vi.useFakeTimers()
    useFetch((_url, init) => new Promise((_, reject) => {
      init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
    }))
    const done = routeMessage(msg({ text: BOOKING_TEXT }), R)
    await vi.advanceTimersByTimeAsync(2001)
    await done
    expectFallback()
    expect(classifications.rows[0]).toMatchObject({ outcome: 'error', label: null, confidence: null })
  })

  it('a 5,000-char message → request input ≤ 1,000 chars', async () => {
    useFetch(async () => answer('other', 0.9))
    await routeMessage(msg({ text: '訂'.repeat(5000) }), R)
    const body = JSON.parse(String(lastInit?.body))
    expect(body.input.length).toBeLessThanOrEqual(1000)
    expect(body.input).toBe('訂'.repeat(1000))
  })
})

describe('W2-06 R13: the booking label writes nothing but the record and a chat token', () => {
  it('no handler with side effects runs and no direct DB client is opened', async () => {
    await routeMessage(msg({ text: BOOKING_TEXT }), R)
    expect(classifications.rows).toHaveLength(1)
    expect(tokens.mints).toHaveLength(1)
    for (const fn of [handleJoin, handleClaim, handlePoints, handleRewards, handleReceiptImage, handleOptinConfirmation]) {
      expect(fn).not.toHaveBeenCalled()
    }
    expect(createServerSupabaseClient).not.toHaveBeenCalled()
  })
})

describe('W2-07 replay (AC-7, R17)', () => {
  it('the same wamid twice → one row, one reply, no throw', async () => {
    await routeMessage(msg({ text: BOOKING_TEXT }), R)
    await routeMessage(msg({ text: BOOKING_TEXT }), R) // a throw fails the test
    expect(classifications.rows).toHaveLength(1)
    expect(sendCtaUrlButton).toHaveBeenCalledTimes(1)
    expect(handleUnknown).not.toHaveBeenCalled()
  })
})

describe('W2-08 R8: classifier error paths log no text and no full phone', () => {
  afterEach(() => vi.restoreAllMocks())

  it.each<[string, FetchStub]>([
    ['500', async () => json(500, { error: { message: `echo ${BOOKING_TEXT}` } })],
    ['network', async () => { throw new TypeError(`fetch failed for ${BOOKING_TEXT}`) }],
    ['safety', async () => json(400, { error: { code: 'safety', message: BOOKING_TEXT } })],
  ])('%s', async (_, stub) => {
    const consoleCalls: unknown[] = []
    for (const m of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(console, m).mockImplementation((...args) => { consoleCalls.push(args) })
    }
    useFetch(stub)
    const log = vi.fn()
    await routeMessage(msg({ text: BOOKING_TEXT }), R, log)
    const captured = JSON.stringify([log.mock.calls, consoleCalls])
    expect(captured).toContain('booking.classifier_error')
    expect(captured).not.toContain(BOOKING_TEXT)
    expect(captured).not.toContain('91234567')
  })
})
