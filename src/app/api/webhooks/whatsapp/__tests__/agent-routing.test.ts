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
import { handleUnknown, handleHelp } from '../unknown-help-handlers'
import { handlePoints } from '../join-and-image-handlers'
import { inboundBookingDeps } from '@/application/booking/inbound-booking-deps'
import { admitAgentDeps } from '@/application/agent/agent-deps'
import { createGeminiAgentClient } from '@/infrastructure/gemini/agent-client'
import { getReplyConfig } from '@/infrastructure/supabase/repositories/restaurant-repository'
import { resolveReplyConfig } from '@/domain/services/reply-config'
import { DEFAULT_BOOKING_CONFIG } from '@/domain/value-objects/booking-config'
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
    expect(enqueued).toEqual([{ job: { restaurantId: R, phone: PHONE, messageRowId: userRows()[0].id }, delayMs: 3000 }])
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
    store.seed({ restaurant_id: R, phone: PHONE, role: 'model', outcome: 'sent', text: 'x' })
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
