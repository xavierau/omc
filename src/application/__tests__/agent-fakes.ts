// AGENT-001 test fakes: an in-memory agent_messages / agent_silences store
// with the repository's semantics (scoping, TTL window, newest-N history),
// a scripted model port and a recording worker-deps builder.
import { resolveAgentConfig, type AgentConfig } from '@/domain/value-objects/agent-config'
import {
  HISTORY_MODEL_OUTCOMES,
  MODEL_CALL_OUTCOMES,
  type AgentConversationKey,
  type AgentHistoryMessage,
  type AgentMessageStore,
  type AgentModelRowInput,
  type AgentOutcome,
  type AgentSilenceStore,
  type AgentToolData,
  type AgentUserMessageInput,
  type InsertUserMessageResult,
} from '@/domain/ports/agent-reply'
import type { AgentModelPort, AgentModelRequest, AgentModelResult } from '@/domain/ports/agent-model'
import type { AgentWorkerDeps } from '@/application/agent/process-agent-reply'
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

  async recordModelRow(input: AgentModelRowInput): Promise<void> {
    this.seed({
      restaurant_id: input.restaurantId,
      phone: input.phone,
      role: 'model',
      text: input.text,
      outcome: input.outcome,
      model: input.model,
      latency_ms: input.latencyMs,
      tool_calls: input.toolCalls,
    })
  }

  async latestUserMessageId(key: AgentConversationKey) {
    const users = this.rows.filter((r) => same(r, key) && r.role === 'user')
    return users.length ? users[users.length - 1].id : null
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
        MODEL_CALL_OUTCOMES.includes(r.outcome as AgentOutcome) &&
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
  windowOpen: { value: boolean }
  sendResult: { value: SendResult }
}

export function workerHarness(options: { config?: Record<string, unknown>; model?: FakeAgentModel } = {}): WorkerHarness {
  const clock = new FakeClock()
  const store = new FakeAgentStore(clock)
  const model = options.model ?? new FakeAgentModel([okModel('Hello!')])
  let config: AgentConfig = resolveAgentConfig({ mode: 'auto', ...options.config })
  const sends: WorkerHarness['sends'] = []
  const fallbacks: WorkerHarness['fallbacks'] = []
  const logs: WorkerHarness['logs'] = []
  const windowOpen = { value: true }
  const sendResult = { value: { ok: true, kapsoMessageId: 'wamid.out', raw: null } as SendResult }
  const log: AgentLogFn = (level, event, data) => logs.push({ level, event, data })
  const deps: AgentWorkerDeps = {
    getConfig: async () => config,
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
    log,
  }
  return {
    deps,
    store,
    clock,
    model,
    sends,
    fallbacks,
    logs,
    windowOpen,
    sendResult,
    setConfig: (raw) => {
      config = resolveAgentConfig(raw)
    },
  }
}
