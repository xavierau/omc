// AGENT-001 W1: the webhook side of the reply agent through routeMessage (AC-R1).
import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest'

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
vi.mock('@/infrastructure/whatsapp/messaging', () => ({ sendCtaUrlButton: vi.fn(), sendTextMessage: vi.fn() }))
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
vi.mock('../optin-confirmation', () => ({
  handleOptinConfirmation: vi.fn(async () => false), handleOptinRejection: vi.fn(async () => false),
}))
vi.mock('@/application/booking/inbound-booking-deps', () => ({ inboundBookingDeps: vi.fn() }))
vi.mock('@/infrastructure/supabase/client', () => ({ createServerSupabaseClient: vi.fn() }))
vi.mock('@/application/agent/agent-deps', () => ({ admitAgentDeps: vi.fn(), agentWorkerDeps: vi.fn(), purgeAgentDeps: vi.fn() }))
vi.mock('@/infrastructure/gemini/agent-client', () => ({ createGeminiAgentClient: vi.fn() }))

import { routeMessage } from '../handlers'
import { admitInboundForAgent } from '@/application/agent/admit-inbound-for-agent'
import { handleUnknown, handleHelp } from '../unknown-help-handlers'
import { sendCtaUrlButton } from '@/infrastructure/whatsapp/messaging'
import { resolveLanguageForMember } from '../resolve-language'
import { Language } from '@/domain/value-objects/language'
import { okResult } from '@/test-utils/send-result'
import { handlePoints } from '../join-and-image-handlers'
import { inboundBookingDeps } from '@/application/booking/inbound-booking-deps'
import { admitAgentDeps } from '@/application/agent/agent-deps'
import { createGeminiAgentClient } from '@/infrastructure/gemini/agent-client'
import { getReplyConfig } from '@/infrastructure/supabase/repositories/restaurant-repository'
import { resolveReplyConfig } from '@/domain/services/reply-config'
import { DEFAULT_BOOKING_CONFIG, resolveBookingConfig, type BookingConfig } from '@/domain/value-objects/booking-config'
import { resolveAgentConfig, type AgentConfig } from '@/domain/value-objects/agent-config'
import type { AdmitAgentDeps, AgentReplyJob } from '@/application/agent/admit-inbound-for-agent'
import type { RouteBookingIntentDeps } from '@/application/booking/route-booking-intent'
import type { KapsoMessage } from '@/infrastructure/whatsapp/webhooks'
import { FakeChatTokens, FakeClassificationStore, FakeIntentClassifier } from '@/test-utils/fake-intent-classifier'
import { FakeAgentStore, FakeClock } from '@/application/__tests__/agent-fakes'

const R = 'rest-a'
const PHONE = '+85291234567'
const TEXT = '你哋星期日幾點開?'

let agentConfig: AgentConfig
let store: FakeAgentStore
let enqueued: Array<{ job: AgentReplyJob; delayMs: number }>
let enqueue: AdmitAgentDeps['enqueue']
let fetchSpy: MockInstance<typeof fetch>

const msg = (partial: Partial<KapsoMessage> = {}): KapsoMessage =>
  ({ messageId: 'wamid.in.1', from: PHONE, type: 'text', text: TEXT, timestamp: '1700000000', ...partial }) as KapsoMessage

beforeEach(() => {
  vi.clearAllMocks()
  const clock = new FakeClock()
  store = new FakeAgentStore(clock)
  enqueued = []
  enqueue = async (job, delayMs) => void enqueued.push({ job, delayMs })
  agentConfig = resolveAgentConfig({ mode: 'shadow' })
  vi.mocked(getReplyConfig).mockResolvedValue(resolveReplyConfig({}))
  // Booking intent routing off → the unknown path reaches the agent hook.
  vi.mocked(inboundBookingDeps).mockImplementation((log) => ({
    getConfig: async () => DEFAULT_BOOKING_CONFIG,
    classifier: new FakeIntentClassifier({ ok: true, label: 'other', confidence: 0.9 }),
    classifications: new FakeClassificationStore(),
    tokens: new FakeChatTokens(),
    appUrl: 'https://app.example.com',
    log,
  }) satisfies RouteBookingIntentDeps)
  vi.mocked(admitAgentDeps).mockImplementation((log) => ({
    getConfig: async () => agentConfig,
    messages: store,
    silences: store,
    enqueue: (job, delayMs) => enqueue(job, delayMs),
    now: clock.now,
    log,
  }))
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('no network in tests'))
})

afterEach(() => fetchSpy.mockRestore())

const userRows = () => store.rows.filter((r) => r.role === 'user')
const geminiFetches = () => fetchSpy.mock.calls.filter((call) => String(call[0]).includes('generativelanguage'))

describe('AC-R1 webhook stores + enqueues, never calls the model', () => {
  it('AC-R1 shadow: one agent_messages insert + one enqueue, the fallback menu is still sent', async () => {
    await routeMessage(msg(), R)
    expect(userRows()).toEqual([expect.objectContaining({ restaurant_id: R, phone: PHONE, role: 'user', text: TEXT, wamid: 'wamid.in.1' })])
    expect(enqueued).toEqual([{ job: { restaurantId: R, phone: PHONE, messageRowId: userRows()[0].id, admittedMode: 'shadow' }, delayMs: 3000 }])
    expect(handleUnknown).toHaveBeenCalledTimes(1)
    expect(handleUnknown).toHaveBeenCalledWith('pn-a', PHONE, R)
    expect(createGeminiAgentClient).not.toHaveBeenCalled()
    expect(geminiFetches()).toEqual([])
  })

  it('AC-R1 auto: one insert + one enqueue (delayed debounceMs), no fallback menu, no model call', async () => {
    agentConfig = resolveAgentConfig({ mode: 'auto', debounceMs: 1500 })
    await routeMessage(msg(), R)
    expect(userRows()).toHaveLength(1)
    expect(enqueued).toHaveLength(1)
    expect(enqueued[0].delayMs).toBe(1500)
    expect(enqueued[0].job.admittedMode).toBe('auto')
    expect(handleUnknown).not.toHaveBeenCalled()
    expect(createGeminiAgentClient).not.toHaveBeenCalled()
    expect(geminiFetches()).toEqual([])
  })

  it('AC-R1 the handler resolves as soon as the job is enqueued (the job itself never runs in the request)', async () => {
    agentConfig = resolveAgentConfig({ mode: 'auto', debounceMs: 15000 })
    let resolved = false
    await routeMessage(msg(), R).then(() => (resolved = true))
    expect(resolved).toBe(true)
  })

  it('AC-R1 off: no insert, no enqueue, today’s fallback menu', async () => {
    agentConfig = resolveAgentConfig({ mode: 'off' })
    await routeMessage(msg(), R)
    expect(store.rows).toEqual([])
    expect(enqueued).toEqual([])
    expect(handleUnknown).toHaveBeenCalledTimes(1)
  })

  it('AC-R1 auto + silenced by a handoff: fallback menu, no insert, no job', async () => {
    agentConfig = resolveAgentConfig({ mode: 'auto' })
    await store.silenceUntil({ restaurantId: R, phone: PHONE }, '2026-11-20T00:00:00.000Z')
    await routeMessage(msg(), R)
    expect(store.rows).toEqual([])
    expect(enqueued).toEqual([])
    expect(handleUnknown).toHaveBeenCalledTimes(1)
  })

  it('AC-R1 auto + over the phone limit: fallback once, then quiet; no job', async () => {
    agentConfig = resolveAgentConfig({ mode: 'auto', maxRepliesPerPhonePerHour: 1 })
    store.seed({ restaurant_id: R, phone: PHONE, role: 'model', outcome: 'sent', text: 'x', model: 'gemini-3.8-flash' })
    await routeMessage(msg({ messageId: 'w1' }), R)
    await routeMessage(msg({ messageId: 'w2' }), R)
    expect(enqueued).toEqual([])
    expect(handleUnknown).toHaveBeenCalledTimes(1)
    expect(userRows()).toEqual([])
  })

  it('AC-R1 auto + enqueue failure (Redis down): the diner still gets the fallback menu', async () => {
    agentConfig = resolveAgentConfig({ mode: 'auto' })
    enqueue = async () => {
      throw new Error('ECONNREFUSED')
    }
    await routeMessage(msg(), R)
    expect(handleUnknown).toHaveBeenCalledTimes(1)
  })

  it('AC-R1 any admit error fails toward today’s fallback', async () => {
    agentConfig = resolveAgentConfig({ mode: 'auto' })
    store.insertUserMessage = async () => {
      throw new Error('insertUserMessage: 08006')
    }
    await routeMessage(msg(), R)
    expect(handleUnknown).toHaveBeenCalledTimes(1)
    expect(enqueued).toEqual([])
  })

  it('AC-R1 a webhook retry of the same wamid inserts nothing and sends nothing again', async () => {
    agentConfig = resolveAgentConfig({ mode: 'auto' })
    await routeMessage(msg(), R)
    await routeMessage(msg(), R)
    expect(userRows()).toHaveLength(1)
    expect(enqueued).toHaveLength(1)
    expect(handleUnknown).not.toHaveBeenCalled()
  })

  it('AC-R1 matched keywords and non-text never reach the agent', async () => {
    agentConfig = resolveAgentConfig({ mode: 'auto' })
    await routeMessage(msg({ text: 'POINTS' }), R)
    await routeMessage(msg({ text: 'HELP', messageId: 'w-help' }), R)
    await routeMessage(msg({ type: 'image', text: undefined, messageId: 'w-image' }), R)
    expect(handlePoints).toHaveBeenCalled()
    expect(handleHelp).toHaveBeenCalled()
    expect(store.rows).toEqual([])
    expect(enqueued).toEqual([])
  })
})

describe('AC-F10 the auto gate reads silence and limits concurrently', () => {
  it('AC-F10 admit gate issues isSilenced and the limit check concurrently (both started before either resolves)', async () => {
    const clock = new FakeClock()
    const gateStore = new FakeAgentStore(clock)
    const started: string[] = []
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    gateStore.isSilenced = async () => (started.push('isSilenced'), await gate, false)
    gateStore.countModelCalls = async (_r, phone) => (started.push(phone === null ? 'countTenant' : 'countPhone'), await gate, 0)
    const admitted = admitInboundForAgent(
      { getConfig: async () => resolveAgentConfig({ mode: 'auto' }), messages: gateStore, silences: gateStore, enqueue: async () => {}, now: clock.now, log: () => {} },
      { restaurantId: R, phone: PHONE, wamid: 'w1', text: TEXT }
    )
    await vi.waitFor(() => expect(started.length).toBe(3))
    expect(started.sort()).toEqual(['countPhone', 'countTenant', 'isSilenced'])
    release()
    expect(await admitted).toEqual({ kind: 'queued', mode: 'auto' })
  })
})

// AGENT-004: when the auto agent owns bookings, unmatched text skips BOOK-001's
// single-message classifier and goes straight to the agent; otherwise today's order.
describe('AGENT-004 the classifier yields to an auto agent that is offered a booking tool', () => {
  const BOOKING_TOOLS = ['propose_booking', 'create_booking_request', 'list_my_bookings', 'propose_booking_change', 'confirm_booking_change']
  const REPLY = 'the Friday one, make it 3 of us'
  let bookingConfig: BookingConfig
  let classifier: FakeIntentClassifier
  let classifications: FakeClassificationStore
  let tokens: FakeChatTokens
  let bookingConfigError: Error | null

  const agentWith = (mode: AgentConfig['mode'], extra: Record<string, unknown> = {}) =>
    resolveAgentConfig({ mode, enabledTools: ['get_member_summary', 'list_rewards', 'handoff_to_staff', ...BOOKING_TOOLS], ...extra })

  const expectClassifierFirst = () => {
    expect(classifier.calls).toEqual([REPLY])
    expect(classifications.rows).toHaveLength(1)
    expect(sendCtaUrlButton).toHaveBeenCalledTimes(1)
    expect(enqueued).toEqual([])
    expect(handleUnknown).not.toHaveBeenCalled()
  }

  beforeEach(() => {
    bookingConfig = { ...DEFAULT_BOOKING_CONFIG, mode: 'simple', aiRoutingEnabled: true }
    classifier = new FakeIntentClassifier({ ok: true, label: 'booking', confidence: 0.89 })
    classifications = new FakeClassificationStore()
    tokens = new FakeChatTokens()
    bookingConfigError = null
    vi.mocked(inboundBookingDeps).mockImplementation((log) => ({
      getConfig: async () => {
        if (bookingConfigError) throw bookingConfigError
        return bookingConfig
      },
      classifier,
      classifications,
      tokens,
      appUrl: 'https://app.example.com',
      log,
    }) satisfies RouteBookingIntentDeps)
    vi.mocked(resolveLanguageForMember).mockResolvedValue(Language.ZH_HK)
    vi.mocked(sendCtaUrlButton).mockResolvedValue(okResult())
  })

  it('(a) auto + simple booking + booking tools enabled → agent queued; no classifier call, no CTA, no classification row, no token', async () => {
    agentConfig = agentWith('auto')
    await routeMessage(msg({ text: REPLY }), R)
    expect(classifier.calls).toEqual([])
    expect(classifications.rows).toEqual([])
    expect(tokens.mints).toEqual([])
    expect(sendCtaUrlButton).not.toHaveBeenCalled()
    expect(enqueued).toHaveLength(1)
    expect(enqueued[0].job.admittedMode).toBe('auto')
    expect(userRows()).toEqual([expect.objectContaining({ text: REPLY })])
    expect(handleUnknown).not.toHaveBeenCalled()
  })

  it('(a) auto + external booking + get_booking_link enabled → agent queued, classifier skipped', async () => {
    bookingConfig = { ...bookingConfig, mode: 'external', externalUrl: 'https://booking.example.com/r/demo' }
    agentConfig = resolveAgentConfig({ mode: 'auto', enabledTools: ['get_booking_link'] })
    await routeMessage(msg({ text: REPLY }), R)
    expect(classifier.calls).toEqual([])
    expect(sendCtaUrlButton).not.toHaveBeenCalled()
    expect(enqueued).toHaveLength(1)
  })

  it('(b) auto with no booking tool enabled (default tools) → classifier first, as today', async () => {
    agentConfig = resolveAgentConfig({ mode: 'auto' })
    await routeMessage(msg({ text: REPLY }), R)
    expectClassifierFirst()
  })

  it('(b) auto with maxToolCalls 0 (the worker offers no tool) → classifier first', async () => {
    agentConfig = agentWith('auto', { maxToolCalls: 0 })
    await routeMessage(msg({ text: REPLY }), R)
    expectClassifierFirst()
  })

  it.each(['shadow', 'off'] as const)('(c) %s with booking tools enabled → classifier first, as today', async (mode) => {
    agentConfig = agentWith(mode)
    await routeMessage(msg({ text: REPLY }), R)
    expectClassifierFirst()
  })

  it('(d) auto + booking tools enabled but booking mode off → the classifier hook runs first (declines), then the agent', async () => {
    bookingConfig = { ...DEFAULT_BOOKING_CONFIG, mode: 'off', aiRoutingEnabled: true }
    agentConfig = agentWith('auto')
    await routeMessage(msg({ text: REPLY }), R)
    expect(sendCtaUrlButton).not.toHaveBeenCalled()
    expect(enqueued).toHaveLength(1)
    expect(handleUnknown).not.toHaveBeenCalled()
  })

  it('(d) auto + only simple-mode booking tools while booking mode is external (none effective) → classifier first', async () => {
    bookingConfig = { ...bookingConfig, mode: 'external', externalUrl: 'https://booking.example.com/r/demo' }
    agentConfig = agentWith('auto')
    await routeMessage(msg({ text: REPLY }), R)
    expectClassifierFirst()
  })

  it('(e) the agent config read throws → fall open to the classifier first; one reply only', async () => {
    agentConfig = agentWith('auto')
    vi.mocked(admitAgentDeps).mockImplementation((log) => ({
      getConfig: async () => {
        throw new Error('agent_config: 08006')
      },
      messages: store,
      silences: store,
      enqueue: (job, delayMs) => enqueue(job, delayMs),
      now: () => new Date('2026-11-20T00:00:00.000Z'),
      log,
    }))
    await routeMessage(msg({ text: REPLY }), R)
    expectClassifierFirst()
  })

  it('(e) the booking config read throws while deciding → fall open to the classifier first', async () => {
    agentConfig = agentWith('auto')
    let reads = 0
    vi.mocked(inboundBookingDeps).mockImplementation((log) => ({
      getConfig: async () => {
        if (reads++ === 0) throw new Error('booking_config: 08006')
        return bookingConfig
      },
      classifier,
      classifications,
      tokens,
      appUrl: 'https://app.example.com',
      log,
    }) satisfies RouteBookingIntentDeps)
    await routeMessage(msg({ text: REPLY }), R)
    expectClassifierFirst()
  })

  it.each(['BOOK', '訂位'])('(f) exact %s with the agent owning bookings → booking form sent instantly, agent not queued', async (text) => {
    agentConfig = agentWith('auto')
    await routeMessage(msg({ text }), R)
    expect(sendCtaUrlButton).toHaveBeenCalledTimes(1)
    expect(vi.mocked(sendCtaUrlButton).mock.calls[0][4]).toMatch(/^https:\/\/app\.example\.com\/b\/tok1x+$/)
    expect(classifier.calls).toEqual([])
    expect(store.rows).toEqual([])
    expect(enqueued).toEqual([])
  })

  // BOOK-012: the classifier is on by default; the agent-owns-booking skip still wins.
  it('(g) stored external blob without aiRoutingEnabled + shadow agent → classifier first (BOOK-012)', async () => {
    bookingConfig = resolveBookingConfig({ mode: 'external', externalUrl: 'https://booking.example.com/r/demo' })
    agentConfig = agentWith('shadow')
    await routeMessage(msg({ text: REPLY }), R)
    expectClassifierFirst()
  })

  it('(g) stored simple blob without aiRoutingEnabled + auto agent with booking tools → agent owns it, classifier not called (BOOK-012)', async () => {
    bookingConfig = resolveBookingConfig({ mode: 'simple' })
    agentConfig = agentWith('auto')
    await routeMessage(msg({ text: REPLY }), R)
    expect(classifier.calls).toEqual([])
    expect(sendCtaUrlButton).not.toHaveBeenCalled()
    expect(enqueued).toHaveLength(1)
  })

  // BOOK-012 r2: a crash after the classification row was written (outcome
  // fallback/error) and before the agent stored the text leaves the row
  // behind; the retry must still reach the agent, as with the classifier off.
  const seedEarlier = (outcome: 'fallback' | 'error' | 'booking_reply') =>
    classifications.rows.push({ restaurantId: R, messageId: 'wamid.in.1', label: null, confidence: null, outcome })

  it.each(['fallback', 'error'] as const)('(r2) retry after an earlier %s outcome + shadow agent → agent queued, fallback menu', async (outcome) => {
    seedEarlier(outcome)
    agentConfig = agentWith('shadow')
    await routeMessage(msg({ text: REPLY }), R)
    expect(sendCtaUrlButton).not.toHaveBeenCalled()
    expect(enqueued).toHaveLength(1)
    expect(enqueued[0].job.admittedMode).toBe('shadow')
    expect(handleUnknown).toHaveBeenCalledTimes(1)
  })

  it.each(['fallback', 'error'] as const)('(r2) retry after an earlier %s outcome + auto agent (no booking tool) → agent queued, no menu', async (outcome) => {
    seedEarlier(outcome)
    agentConfig = resolveAgentConfig({ mode: 'auto' })
    await routeMessage(msg({ text: REPLY }), R)
    expect(sendCtaUrlButton).not.toHaveBeenCalled()
    expect(enqueued).toHaveLength(1)
    expect(enqueued[0].job.admittedMode).toBe('auto')
    expect(handleUnknown).not.toHaveBeenCalled()
  })

  it('(r2) retry after an earlier booking_reply → nothing sent, agent not queued, no menu', async () => {
    seedEarlier('booking_reply')
    agentConfig = agentWith('shadow')
    await routeMessage(msg({ text: REPLY }), R)
    expect(sendCtaUrlButton).not.toHaveBeenCalled()
    expect(enqueued).toEqual([])
    expect(handleUnknown).not.toHaveBeenCalled()
  })

  it('a webhook retry of the skipped message queues once and sends nothing', async () => {
    agentConfig = agentWith('auto')
    await routeMessage(msg({ text: REPLY }), R)
    await routeMessage(msg({ text: REPLY }), R)
    expect(enqueued).toHaveLength(1)
    expect(classifier.calls).toEqual([])
    expect(sendCtaUrlButton).not.toHaveBeenCalled()
    expect(handleUnknown).not.toHaveBeenCalled()
  })
})
