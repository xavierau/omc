/**
 * AGENT-001: the worker side of the reply agent, one job per inbound text.
 *
 * Order: latest-wins debounce (a newer diner message supersedes this job) →
 * mode → handoff silence → reply limits (R6) → history within TTL (R5) →
 * model run with the tool loop (8 s per call, 20 s budget) → bounded reply
 * (R10) → shadow: store the draft, send nothing; auto: send it with the
 * disclosure (R11) inside the open service window. Any model failure in auto
 * sends today's fallback menu exactly once; shadow only records `error` (R4).
 * Every run ends in one stored model row (R9), except a superseded job.
 * Logs carry ids, outcome, latency, token counts and tool names, never the
 * text, the phone or the key (R8).
 */
import { effectiveAgentModel, type AgentConfig } from '@/domain/value-objects/agent-config'
import { boundReply, toAgentTurns, withDisclosure } from '@/domain/services/agent-reply-text'
import type { AgentModelFailure, AgentModelPort, AgentModelResult } from '@/domain/ports/agent-model'
import type {
  AgentConversationKey,
  AgentMessageStore,
  AgentOutcome,
  AgentSilenceStore,
  AgentToolData,
} from '@/domain/ports/agent-reply'
import type { SendResult } from '@/domain/value-objects/send-result'
import { buildSystemInstruction } from './agent-prompt'
import { createAgentToolExecutor, declarationsFor } from './agent-tools'
import { HOUR_MS, isOverReplyLimit, isoAgo, recordRateLimited } from './agent-limits'
import type { AgentLogFn, AgentReplyJob } from './admit-inbound-for-agent'

export const PER_CALL_TIMEOUT_MS = 8_000
export const JOB_BUDGET_MS = 20_000

export interface AgentWorkerDeps {
  getConfig(restaurantId: string): Promise<AgentConfig>
  messages: AgentMessageStore
  silences: AgentSilenceStore
  toolData: AgentToolData
  model: AgentModelPort
  isWindowOpen(key: AgentConversationKey): Promise<boolean>
  getPhoneNumberId(restaurantId: string): Promise<string | null>
  sendText(phoneNumberId: string, phone: string, text: string): Promise<SendResult>
  /** Today's fallback menu (handleUnknown); true when it was sent. */
  sendFallback(phoneNumberId: string, phone: string, restaurantId: string): Promise<boolean>
  now(): Date
  envModel: string | undefined
  log: AgentLogFn
}

export type AgentRunResult = AgentOutcome | 'superseded'

interface RunRecord {
  outcome: AgentOutcome
  text: string | null
  model: string | null
  latencyMs: number | null
  toolCalls: string[]
  reason?: AgentModelFailure | 'window_closed' | 'send_failed' | 'no_phone_number' | 'silenced' | 'mode_off'
  usage?: { promptTokens: number; outputTokens: number }
}

class Run {
  fallbackSent = false
  /** Set once the config is read; an auto run that throws before sending anything falls back (R4). */
  mode: AgentConfig['mode'] = 'off'
  replySent = false
  constructor(
    readonly deps: AgentWorkerDeps,
    readonly job: AgentReplyJob,
    readonly key: AgentConversationKey
  ) {}

  async fallback(): Promise<boolean> {
    if (this.fallbackSent) return true
    const phoneNumberId = await this.deps.getPhoneNumberId(this.key.restaurantId)
    if (!phoneNumberId) return false
    this.fallbackSent = true
    return this.deps.sendFallback(phoneNumberId, this.key.phone, this.key.restaurantId)
  }

  async finish(record: RunRecord): Promise<AgentOutcome> {
    await this.deps.messages.recordModelRow({
      ...this.key,
      outcome: record.outcome,
      text: record.text,
      model: record.model,
      latencyMs: record.latencyMs,
      toolCalls: record.toolCalls,
    })
    this.deps.log('info', 'agent.reply', {
      messageId: this.job.messageRowId,
      restaurantId: this.key.restaurantId,
      outcome: record.outcome,
      ...(record.reason ? { reason: record.reason } : {}),
      latencyMs: record.latencyMs,
      promptTokens: record.usage?.promptTokens ?? 0,
      outputTokens: record.usage?.outputTokens ?? 0,
      toolCalls: record.toolCalls,
    })
    return record.outcome
  }
}

const skipped = (reason: RunRecord['reason']): RunRecord => ({
  outcome: 'skipped',
  text: null,
  model: null,
  latencyMs: null,
  toolCalls: [],
  reason,
})

async function callModel(run: Run, config: AgentConfig, model: string): Promise<{ result: AgentModelResult; latencyMs: number }> {
  const { deps, key } = run
  const now = deps.now()
  const rows = await deps.messages.history(key, config.maxHistoryMessages, isoAgo(now, config.historyTtlHours * HOUR_MS))
  const executeTool = createAgentToolExecutor({
    key,
    enabledTools: config.enabledTools,
    handoffSilenceHours: config.handoffSilenceHours,
    now: deps.now,
    data: deps.toolData,
    silences: deps.silences,
  })
  const started = Date.now()
  const result = await deps.model.respond({
    model,
    systemInstruction: buildSystemInstruction(config),
    history: toAgentTurns(rows),
    tools: declarationsFor(config.enabledTools),
    executeTool,
    temperature: config.temperature,
    maxOutputTokens: config.maxOutputTokens,
    maxToolCalls: config.maxToolCalls,
    perCallTimeoutMs: PER_CALL_TIMEOUT_MS,
    budgetMs: JOB_BUDGET_MS,
  })
  return { result, latencyMs: Date.now() - started }
}

/** The model's answer bounded for sending, or the failure that replaces it (R10: empty → failure). */
function boundResult(result: AgentModelResult, config: AgentConfig): { reply: string } | { reason: AgentModelFailure } {
  if (!result.ok) return { reason: result.reason }
  const reply = boundReply(result.text, config.maxReplyChars, config.disclosureText)
  return reply ? { reply } : { reason: 'empty' }
}

async function deliver(run: Run, config: AgentConfig, base: Omit<RunRecord, 'outcome' | 'text'>, reply: string): Promise<RunRecord> {
  const { deps, key } = run
  if (!(await deps.isWindowOpen(key))) return { ...base, outcome: 'skipped', text: reply, reason: 'window_closed' }
  const phoneNumberId = await deps.getPhoneNumberId(key.restaurantId)
  if (!phoneNumberId) return { ...base, outcome: 'error', text: reply, reason: 'no_phone_number' }
  const sent = await deps.sendText(phoneNumberId, key.phone, withDisclosure(reply, config.disclosureText))
  run.replySent = sent.ok
  return sent.ok ? { ...base, outcome: 'sent', text: reply } : { ...base, outcome: 'error', text: reply, reason: 'send_failed' }
}

async function answer(run: Run, config: AgentConfig): Promise<RunRecord> {
  const model = effectiveAgentModel(config, run.deps.envModel)
  const { result, latencyMs } = await callModel(run, config, model)
  const base = { model, latencyMs, toolCalls: result.toolCalls, usage: result.usage }
  const bounded = boundResult(result, config)

  if ('reason' in bounded) {
    if (config.mode === 'shadow') return { ...base, outcome: 'error', text: null, reason: bounded.reason }
    const fellBack = await run.fallback()
    return { ...base, outcome: fellBack ? 'fallback' : 'error', text: null, reason: bounded.reason }
  }
  if (config.mode === 'shadow') return { ...base, outcome: 'shadow_draft', text: bounded.reply }
  return deliver(run, config, base, bounded.reply)
}

async function process(run: Run): Promise<AgentRunResult> {
  const { deps, job, key } = run
  const latest = await deps.messages.latestUserMessageId(key)
  if (latest !== job.messageRowId) {
    deps.log('info', 'agent.superseded', { messageId: job.messageRowId, restaurantId: key.restaurantId })
    return 'superseded'
  }

  const config = await deps.getConfig(key.restaurantId)
  run.mode = config.mode
  if (config.mode === 'off') return run.finish(skipped('mode_off'))
  const now = deps.now()
  if (await deps.silences.isSilenced(key, now.toISOString())) return run.finish(skipped('silenced'))

  if (await isOverReplyLimit(deps.messages, key, config, now)) {
    // recordRateLimited stores the row; finish() would store a second one.
    const first = await recordRateLimited(deps.messages, key, now)
    if (config.mode === 'auto' && first) await run.fallback()
    deps.log('info', 'agent.reply', { messageId: job.messageRowId, restaurantId: key.restaurantId, outcome: 'rate_limited' })
    return 'rate_limited'
  }

  return run.finish(await answer(run, config))
}

export async function processAgentReply(deps: AgentWorkerDeps, job: AgentReplyJob): Promise<AgentRunResult> {
  const run = new Run(deps, job, { restaurantId: job.restaurantId, phone: job.phone })
  try {
    return await process(run)
  } catch (err) {
    deps.log('error', 'agent.job_failed', {
      messageId: job.messageRowId,
      restaurantId: job.restaurantId,
      errorClass: (err as Error)?.name ?? 'unknown',
    })
    if (run.mode === 'auto' && !run.replySent) await run.fallback().catch(() => false)
    return 'error'
  }
}
