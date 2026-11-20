// AGENT-001 test fakes: an in-memory agent_messages / agent_silences store
// with the repository's semantics (scoping, TTL window, newest-N history),
// a scripted model port and a recording worker-deps builder.
import { resolveAgentConfig, type AgentConfig } from '@/domain/value-objects/agent-config'
import {
  HISTORY_MODEL_OUTCOMES,
  REPLY_CLAIM_OUTCOMES,
  type AgentConversationKey,
  type AgentHistoryMessage,
  type AgentMessageStore,
  type AgentModelRowInput,
  type AgentOutcome,
  type AgentSilenceStore,
  type AgentToolData,
  type AgentUserMessageInput,
  type InsertUserMessageResult,
  type RecordModelRowResult,
} from '@/domain/ports/agent-reply'
import type { AgentModelPort, AgentModelRequest, AgentModelResult } from '@/domain/ports/agent-model'
import type { AgentBookingWorkerDeps, AgentWorkerDeps } from '@/application/agent/process-agent-reply'
import type {
  AgentBookingProposal,
  AgentProposalKind,
  AgentProposalStore,
  TakeProposalResult,
} from '@/domain/ports/agent-booking-proposal'
import { FakeBookingRequests, FakeBookingSender, FakeBookingSettings } from '@/test-utils/fake-booking'
import type { AgentLogFn } from '@/application/agent/admit-inbound-for-agent'
import type { SendResult } from '@/domain/value-objects/send-result'

export interface FakeAgentRow {
  id: string
  restaurant_id: string
  phone: string
  role: 'user' | 'model'
  text: string | null
  wamid: string | null
  outcome: AgentOutcome | null
  model: string | null
  latency_ms: number | null
  tool_calls: string[]
  reply_to_message_id: string | null
  created_at: string
}

export class FakeClock {
  constructor(public ms = Date.parse('2026-11-19T10:00:00.000Z')) {}
  now = () => new Date(this.ms)
  advance(ms: number) {
    this.ms += ms
  }
}

const same = (row: FakeAgentRow, key: AgentConversationKey) =>
  row.restaurant_id === key.restaurantId && row.phone === key.phone

export class FakeAgentStore implements AgentMessageStore, AgentSilenceStore {
  rows: FakeAgentRow[] = []
  silences = new Map<string, string>()
  private seq = 0
  constructor(private clock: FakeClock) {}

  modelRows() {
    return this.rows.filter((r) => r.role === 'model')
  }

  /** Test seeding: a row at an explicit time. */
  seed(partial: Partial<FakeAgentRow> & Pick<FakeAgentRow, 'restaurant_id' | 'phone' | 'role'>): FakeAgentRow {
    const row: FakeAgentRow = {
      id: `row-${++this.seq}`,
      text: null,
      wamid: null,
      outcome: null,
      model: null,
      latency_ms: null,
      tool_calls: [],
      reply_to_message_id: null,
      created_at: this.clock.now().toISOString(),
      ...partial,
    }
    this.rows.push(row)
    return row
  }

  async insertUserMessage(input: AgentUserMessageInput): Promise<InsertUserMessageResult> {
    if (this.rows.some((r) => r.restaurant_id === input.restaurantId && r.wamid === input.wamid)) return { kind: 'duplicate' }
    const row = this.seed({ restaurant_id: input.restaurantId, phone: input.phone, role: 'user', text: input.text, wamid: input.wamid })
    return { kind: 'inserted', id: row.id }
  }

  /** Mirrors migration 083's partial UNIQUE: one sent/shadow_draft/fallback row per reply_to_message_id. */
  async recordModelRow(input: AgentModelRowInput): Promise<RecordModelRowResult> {
    const claims = (outcome: AgentOutcome | null) => REPLY_CLAIM_OUTCOMES.includes(outcome as AgentOutcome)
    if (
      input.replyToMessageId !== null &&
      claims(input.outcome) &&
      this.rows.some((r) => r.reply_to_message_id === input.replyToMessageId && claims(r.outcome))
    ) {
      return { kind: 'taken' }
    }
    const row = this.seed({
      restaurant_id: input.restaurantId,
      phone: input.phone,
      role: 'model',
      text: input.text,
      outcome: input.outcome,
      model: input.model,
      latency_ms: input.latencyMs,
      tool_calls: input.toolCalls,
      reply_to_message_id: input.replyToMessageId,
    })
    return { kind: 'inserted', id: row.id }
  }

  async setModelOutcome(key: AgentConversationKey, id: string, outcome: AgentOutcome) {
    const row = this.rows.find((r) => r.id === id && same(r, key))
    if (row) row.outcome = outcome
  }

  async latestUserMessageId(key: AgentConversationKey) {
    const users = this.rows.filter((r) => same(r, key) && r.role === 'user')
    return users.length ? users[users.length - 1].id : null
  }

  async userMessageCreatedAt(key: AgentConversationKey, id: string) {
    return this.rows.find((r) => r.id === id && same(r, key) && r.role === 'user')?.created_at ?? null
  }

  async history(key: AgentConversationKey, limit: number, sinceIso: string): Promise<AgentHistoryMessage[]> {
    return this.rows
      .filter((r) => same(r, key) && r.created_at >= sinceIso)
      .filter((r) => r.role === 'user' || HISTORY_MODEL_OUTCOMES.includes(r.outcome as AgentOutcome))
      .filter((r) => r.text)
      .slice(-limit)
      .map((r) => ({ role: r.role, text: r.text as string, createdAt: r.created_at }))
  }

  async countModelCalls(restaurantId: string, phone: string | null, sinceIso: string) {
    return this.rows.filter(
      (r) =>
        r.restaurant_id === restaurantId &&
        (phone === null || r.phone === phone) &&
        r.role === 'model' &&
        r.model !== null &&
        r.created_at >= sinceIso
    ).length
  }

  async hasRateLimitedSince(key: AgentConversationKey, sinceIso: string) {
    return this.rows.some((r) => same(r, key) && r.outcome === 'rate_limited' && r.created_at >= sinceIso)
  }

  async purgeOlderThan(restaurantId: string, beforeIso: string) {
    const before = this.rows.length
    this.rows = this.rows.filter((r) => !(r.restaurant_id === restaurantId && r.created_at < beforeIso))
    return before - this.rows.length
  }

  async isSilenced(key: AgentConversationKey, nowIso: string) {
    const until = this.silences.get(`${key.restaurantId}|${key.phone}`)
    return until !== undefined && until > nowIso
  }

  async silenceUntil(key: AgentConversationKey, untilIso: string) {
    this.silences.set(`${key.restaurantId}|${key.phone}`, untilIso)
  }

  async purgeExpired(nowIso: string) {
    let n = 0
    for (const [k, until] of this.silences) {
      if (until < nowIso) {
        this.silences.delete(k)
        n++
      }
    }
    return n
  }
}

/** AGENT-003 R15 + review F1: the Redis proposal store's semantics (TTL on the clock, owner, confirmable, atomic take-if-earlier). */
export class FakeProposalStore implements AgentProposalStore {
  entries = new Map<string, { proposal: AgentBookingProposal; expiresAt: number; owner: string; confirmable: boolean }>()
  constructor(private clock: FakeClock) {}
  private k(key: AgentConversationKey) {
    return `${key.restaurantId}|${key.phone}`
  }
  private live(key: AgentConversationKey) {
    const entry = this.entries.get(this.k(key))
    return entry && entry.expiresAt > this.clock.ms ? entry : undefined
  }
  async save(key: AgentConversationKey, proposal: AgentBookingProposal, ttlMs: number, owner: string) {
    this.entries.set(this.k(key), { proposal, expiresAt: this.clock.ms + ttlMs, owner, confirmable: false })
  }
  async markConfirmable(key: AgentConversationKey, owner: string) {
    const entry = this.live(key)
    if (!entry || entry.owner !== owner) return false
    entry.confirmable = true
    return true
  }
  async discard(key: AgentConversationKey, owner: string) {
    if (this.entries.get(this.k(key))?.owner === owner) this.entries.delete(this.k(key))
  }
  /** Tool-level tests: the proposing job's read-back reached the diner (the worker's markConfirmable). */
  deliverAll() {
    for (const entry of this.entries.values()) entry.confirmable = true
  }
  async peekKind(key: AgentConversationKey): Promise<AgentProposalKind | null> {
    const entry = this.live(key)
    return entry?.confirmable ? entry.proposal.kind : null
  }
  async takeIfEarlier(key: AgentConversationKey, inboundCreatedAt: string, kind: AgentProposalKind): Promise<TakeProposalResult> {
    const entry = this.live(key)
    if (!entry) return { kind: 'none' }
    if (entry.proposal.kind !== kind) return { kind: 'other_kind' }
    if (Date.parse(entry.proposal.inboundCreatedAt) >= Date.parse(inboundCreatedAt)) return { kind: 'not_earlier' }
    if (!entry.confirmable) return { kind: 'none' }
    this.entries.delete(this.k(key))
    return { kind: 'taken', proposal: entry.proposal }
  }
}

export interface FakeBookingWorld {
  deps: AgentBookingWorkerDeps
  settings: FakeBookingSettings
  requests: FakeBookingRequests
  sender: FakeBookingSender
  proposals: FakeProposalStore
  unverified: { value: number }
  memberIds: Map<string, string>
  /** R24 texts the tools sent. */
  texts: Array<{ restaurantId: string; phone: string; text: string }>
}

/** BOOK-001 fakes behind the agent's booking tools (booking mode off until a test sets it). */
export function fakeBookingWorld(clock: FakeClock): FakeBookingWorld {
  const settings = new FakeBookingSettings()
  const requests = new FakeBookingRequests()
  const sender = new FakeBookingSender()
  const proposals = new FakeProposalStore(clock)
  const unverified = { value: 0 }
  const memberIds = new Map<string, string>()
  const texts: FakeBookingWorld['texts'] = []
  return {
    texts,
    settings,
    requests,
    sender,
    proposals,
    unverified,
    memberIds,
    deps: {
      getConfig: (restaurantId) => settings.getConfig(restaurantId),
      proposals,
      requests,
      countLiveUnverified: async () => unverified.value,
      members: { findMemberId: async (restaurantId, phone) => memberIds.get(`${restaurantId}|${phone}`) ?? null },
      settings,
      sender,
      diner: requests,
      notifyText: async (restaurantId, phone, text) => (texts.push({ restaurantId, phone, text }), true),
    },
  }
}

/** Scripted model: each call returns the next result; records requests. */
export class FakeAgentModel implements AgentModelPort {
  requests: AgentModelRequest[] = []
  constructor(public results: Array<AgentModelResult | ((req: AgentModelRequest) => Promise<AgentModelResult>)>) {}
  async respond(req: AgentModelRequest): Promise<AgentModelResult> {
    this.requests.push(req)
    const next = this.results.length > 1 ? this.results.shift() : this.results[0]
    if (!next) throw new Error('FakeAgentModel: no scripted result')
    return typeof next === 'function' ? next(req) : next
  }
}

export const okModel = (text: string, toolCalls: string[] = []): AgentModelResult => ({
  ok: true,
  text,
  toolCalls,
  usage: { promptTokens: 120, outputTokens: 30 },
})

export const failedModel = (reason: Extract<AgentModelResult, { ok: false }>['reason']): AgentModelResult => ({
  ok: false,
  reason,
  toolCalls: [],
  usage: { promptTokens: 0, outputTokens: 0 },
})

export const fakeToolData = (): AgentToolData & { calls: string[] } => {
  const calls: string[] = []
  return {
    calls,
    async getMemberSummary(key) {
      calls.push(`member:${key.restaurantId}:${key.phone}`)
      return { member: true, pointsBalance: 120, stampCards: [] }
    },
    async listRewards(restaurantId) {
      calls.push(`rewards:${restaurantId}`)
      return [{ name: 'Free coffee', pointsCost: 100, discount: 'HK$30 off' }]
    },
    async getContactAction(restaurantId) {
      calls.push(`contact:${restaurantId}`)
      return { url: 'https://wa.me/85290000000', label: 'Chat with us', text: null }
    },
  }
}

export interface WorkerHarness {
  deps: AgentWorkerDeps
  store: FakeAgentStore
  clock: FakeClock
  model: FakeAgentModel
  sends: Array<{ phoneNumberId: string; phone: string; text: string }>
  fallbacks: Array<{ phoneNumberId: string; phone: string; restaurantId: string }>
  logs: Array<{ level: string; event: string; data: Record<string, unknown> }>
  setConfig(raw: Record<string, unknown>): void
  /** What the webhook's (never failing) config read sees. */
  currentConfig(): AgentConfig
  /** false → the worker's config read fails. */
  configReadable: { value: boolean }
  windowOpen: { value: boolean }
  sendResult: { value: SendResult }
  booking: FakeBookingWorld
}

export function workerHarness(options: { config?: Record<string, unknown>; model?: FakeAgentModel } = {}): WorkerHarness {
  const clock = new FakeClock()
  const store = new FakeAgentStore(clock)
  const model = options.model ?? new FakeAgentModel([okModel('Hello!')])
  // AGENT-001's R4 tests pin today's menu; AGENT-003 R19 tests pass failureAction 'handoff' (the product default).
  let config: AgentConfig = resolveAgentConfig({ mode: 'auto', failureAction: 'menu', ...options.config })
  const sends: WorkerHarness['sends'] = []
  const fallbacks: WorkerHarness['fallbacks'] = []
  const logs: WorkerHarness['logs'] = []
  const windowOpen = { value: true }
  const configReadable = { value: true }
  const sendResult = { value: { ok: true, kapsoMessageId: 'wamid.out', raw: null } as SendResult }
  const log: AgentLogFn = (level, event, data) => logs.push({ level, event, data })
  const booking = fakeBookingWorld(clock)
  const deps: AgentWorkerDeps = {
    getConfig: async () => (configReadable.value ? { ok: true, config } : { ok: false }),
    messages: store,
    silences: store,
    toolData: fakeToolData(),
    model,
    isWindowOpen: async () => windowOpen.value,
    getPhoneNumberId: async () => 'pn-1',
    sendText: async (phoneNumberId, phone, text) => (sends.push({ phoneNumberId, phone, text }), sendResult.value),
    sendFallback: async (phoneNumberId, phone, restaurantId) => (fallbacks.push({ phoneNumberId, phone, restaurantId }), true),
    now: clock.now,
    envModel: undefined,
    envFallbackModel: undefined,
    booking: booking.deps,
    log,
  }
  return {
    deps,
    booking,
    store,
    clock,
    model,
    sends,
    fallbacks,
    logs,
    windowOpen,
    configReadable,
    sendResult,
    currentConfig: () => config,
    setConfig: (raw) => {
      config = resolveAgentConfig(raw)
    },
  }
}
