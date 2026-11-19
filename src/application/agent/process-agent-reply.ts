/**
 * AGENT-001: the worker side of the reply agent, one job per inbound text.
 *
 * Order: latest-wins debounce (a newer diner message supersedes this job) →
 * config (a failed read is an error, not mode off) → mode → handoff silence →
 * reply limits (R6) → history within TTL (R5) → model run with the tool loop
 * (`perCallTimeoutMs` per call, 20 s budget) → re-check latest-wins and silence (jobs of one
 * conversation overlap: concurrency 3) → bounded reply (R10) → shadow: store
 * the draft, send nothing; auto: send it with the disclosure (R11) inside the
 * open service window.
 *
 * R4, exactly one response: a job the webhook admitted under `auto` had the
 * fallback menu suppressed, so any failure (model, send, config read, mode
 * switched off since, silenced by a handoff) sends today's fallback menu
 * once; a superseded job sends nothing (the newer job owns the response);
 * shadow only records.
 * The job never sends more than it was admitted for nor more than the tenant
 * now allows (`effectiveMode`). The answer row is inserted BEFORE the send
 * (`reply_to_message_id` is unique per user row), so a stalled job re-run by
 * BullMQ sends nothing ('duplicate').
 *
 * Every run ends in one stored model row (R9), except a job superseded before
 * its model call and a duplicate run. Logs carry ids, outcome, latency, token
 * counts and tool names, never the text, the phone or the key (R8).
 *
 * AGENT-003 R19: an agent failure (every model failure class, an unreadable
 * config, a job error) answers an auto-admitted message with the tenant's
 * `failureAction`: the handoff reply (default; outcome `handoff`, which flags
 * the thread "needs staff"; no silence row) or today's fallback menu. A
 * handoff that cannot be sent falls back to the menu, so the diner still gets
 * exactly one response. Non-failures (mode switched off, silenced, rate
 * limited, a reply whose send failed) keep the menu.
 *
 * AGENT-003: the tool context gets the tenant's booking settings (read only
 * when a booking tool is enabled; a failed read offers none) and the job's
 * inbound row time for the R15 gate. Shadow and auto run the booking tools
 * alike (OR5). R18: the model port retries and falls back; the row records
 * the model that actually answered and the log line its last HTTP status.
 */
import {
  DEFAULT_AGENT_CONFIG,
  effectiveAgentModel,
  effectiveFallbackModel,
  type AgentConfig,
  type AgentMode,
} from '@/domain/value-objects/agent-config'
import type { BookingConfig } from '@/domain/value-objects/booking-config'
import { boundReply, handoffReplyText, toAgentTurns, withDisclosure } from '@/domain/services/agent-reply-text'
import type { AgentModelFailure, AgentModelPort, AgentModelResult } from '@/domain/ports/agent-model'
import type {
  AgentConfigRead,
  AgentConversationKey,
  AgentMessageStore,
  AgentModelRowInput,
  AgentOutcome,
  AgentSilenceStore,
  AgentToolData,
} from '@/domain/ports/agent-reply'
import type { SendResult } from '@/domain/value-objects/send-result'
import { buildSystemInstruction } from './agent-prompt'
import { createAgentToolExecutor, declarationsFor, offeredTools } from './agent-tools'
import { isAgentBookingTool, type AgentBookingToolContext } from './agent-booking-tools'
import { HOUR_MS, isOverReplyLimit, isoAgo, recordRateLimited } from './agent-limits'
import type { AgentLogFn, AgentReplyJob } from './admit-inbound-for-agent'

export const JOB_BUDGET_MS = 20_000

/** AGENT-003: what the booking tools need besides the job key and inbound row time. */
export interface AgentBookingWorkerDeps extends Omit<AgentBookingToolContext, 'config' | 'inboundCreatedAt'> {
  getConfig(restaurantId: string): Promise<BookingConfig>
}

export interface AgentWorkerDeps {
  getConfig(restaurantId: string): Promise<AgentConfigRead>
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
  /** R18: env AGENT_FALLBACK_MODEL. */
  envFallbackModel: string | undefined
  booking: AgentBookingWorkerDeps
  log: AgentLogFn
}

/** `duplicate`: another run of the same job already answered this message (BullMQ stall re-run). */
export type AgentRunResult = AgentOutcome | 'superseded' | 'duplicate'

interface RunRecord {
  outcome: AgentOutcome
  text: string | null
  model: string | null
  latencyMs: number | null
  toolCalls: string[]
  reason?:
    | AgentModelFailure
    | 'window_closed'
    | 'send_failed'
    | 'no_phone_number'
    | 'silenced'
    | 'superseded'
    | 'mode_off'
    | 'mode_changed'
    | 'config_unavailable'
  usage?: { promptTokens: number; outputTokens: number }
  /** R18: status of the model's last HTTP response (a number only, R8). */
  httpStatus?: number
}

/** The lower of the admitted and the current mode: a job never sends more than either allows. */
export function effectiveMode(admitted: AgentReplyJob['admittedMode'], current: AgentMode): AgentMode {
  if (current === 'off') return 'off'
  return admitted === 'auto' && current === 'auto' ? 'auto' : 'shadow'
}

class Run {
  fallbackSent = false
  /** R19: the handoff reply went out; it is this run's one response. */
  handoffSent = false
  replySent = false
  /** The tenant's config once read; null before (or when the read failed). */
  config: AgentConfig | null = null
  /** Set when this run's own handoff_to_staff silenced the diner: that silence must not stop its own reply. */
  silencedByThisRun = false
  private claimed: { id: string; outcome: AgentOutcome } | null = null
  constructor(
    readonly deps: AgentWorkerDeps,
    readonly job: AgentReplyJob,
    readonly key: AgentConversationKey
  ) {}

  /** The webhook suppressed the fallback menu (admitted under auto): this run owes the diner one response. */
  get owesResponse(): boolean {
    return this.job.admittedMode === 'auto'
  }

  async fallback(): Promise<boolean> {
    if (this.fallbackSent || this.handoffSent) return true
    const phoneNumberId = await this.deps.getPhoneNumberId(this.key.restaurantId)
    if (!phoneNumberId) return false
    this.fallbackSent = true
    return this.deps.sendFallback(phoneNumberId, this.key.phone, this.key.restaurantId)
  }

  /** R19: the configured response to an agent failure (default handoff when the config is unreadable). */
  get failureAction(): AgentConfig['failureAction'] {
    return (this.config ?? DEFAULT_AGENT_CONFIG).failureAction
  }

  /** R19: the handoff reply's text, with the tenant's contact action when it can be read. */
  async handoffText(): Promise<string> {
    const contact = await this.deps.toolData.getContactAction(this.key.restaurantId).catch(() => null)
    return handoffReplyText(contact)
  }

  /** R19: sends the handoff reply once; false when it did not go out (the caller sends the menu). */
  async sendHandoff(text: string): Promise<boolean> {
    if (this.fallbackSent || this.handoffSent) return this.handoffSent
    const phoneNumberId = await this.deps.getPhoneNumberId(this.key.restaurantId)
    if (!phoneNumberId) return false
    const disclosure = (this.config ?? DEFAULT_AGENT_CONFIG).disclosureText
    const result = await this.deps.sendText(phoneNumberId, this.key.phone, withDisclosure(text, disclosure)).catch(() => null)
    this.handoffSent = result?.ok === true
    return this.handoffSent
  }

  /** R19 for a failure with no row of its own (a job error): handoff, else the menu. */
  async respondToFailure(): Promise<void> {
    if (this.failureAction === 'handoff' && (await this.sendHandoff(await this.handoffText()))) return
    await this.fallback()
  }

  private row(record: RunRecord): AgentModelRowInput {
    return {
      ...this.key,
      outcome: record.outcome,
      text: record.text,
      model: record.model,
      latencyMs: record.latencyMs,
      toolCalls: record.toolCalls,
      replyToMessageId: this.job.messageRowId,
    }
  }

  /** Stores the answer row BEFORE its side effect; false when another run of this job already answered. */
  async claim(record: RunRecord): Promise<boolean> {
    const stored = await this.deps.messages.recordModelRow(this.row(record))
    if (stored.kind === 'taken') return false
    this.claimed = { id: stored.id, outcome: record.outcome }
    return true
  }

  async finish(record: RunRecord): Promise<AgentOutcome> {
    if (!this.claimed) await this.deps.messages.recordModelRow(this.row(record))
    else if (this.claimed.outcome !== record.outcome) {
      await this.deps.messages.setModelOutcome(this.key, this.claimed.id, record.outcome)
    }
    this.deps.log('info', 'agent.reply', {
      messageId: this.job.messageRowId,
      restaurantId: this.key.restaurantId,
      outcome: record.outcome,
      ...(record.reason ? { reason: record.reason } : {}),
      latencyMs: record.latencyMs,
      ...(record.httpStatus !== undefined ? { httpStatus: record.httpStatus } : {}),
      promptTokens: record.usage?.promptTokens ?? 0,
      outputTokens: record.usage?.outputTokens ?? 0,
      toolCalls: record.toolCalls,
    })
    return record.outcome
  }
}

const noModelCall = (outcome: AgentOutcome, reason: RunRecord['reason']): RunRecord => ({
  outcome,
  text: null,
  model: null,
  latencyMs: null,
  toolCalls: [],
  reason,
})

const skipped = (reason: RunRecord['reason']): RunRecord => noModelCall('skipped', reason)

/** The tenant's booking settings for the tools; null (no booking tool) when none is enabled or the read failed. */
async function bookingContext(run: Run, config: AgentConfig): Promise<AgentBookingToolContext | null> {
  const { deps, key, job } = run
  if (!config.enabledTools.some(isAgentBookingTool)) return null
  const { getConfig, ...ports } = deps.booking
  const bookingConfig = await getConfig(key.restaurantId).catch(() => null)
  if (!bookingConfig) return null
  let inbound: Promise<string | null> | null = null
  return {
    ...ports,
    config: bookingConfig,
    inboundCreatedAt: () => (inbound ??= deps.messages.userMessageCreatedAt(key, job.messageRowId)),
  }
}

async function callModel(run: Run, config: AgentConfig, model: string): Promise<{ result: AgentModelResult; latencyMs: number }> {
  const { deps, key } = run
  const now = deps.now()
  const rows = await deps.messages.history(key, config.maxHistoryMessages, isoAgo(now, config.historyTtlHours * HOUR_MS))
  const booking = await bookingContext(run, config)
  const bookingMode = booking?.config.mode ?? null
  const executeTool = createAgentToolExecutor({
    key,
    enabledTools: config.enabledTools,
    handoffSilenceHours: config.handoffSilenceHours,
    now: deps.now,
    data: deps.toolData,
    silences: {
      silenceUntil: async (silenceKey, untilIso) => {
        await deps.silences.silenceUntil(silenceKey, untilIso)
        run.silencedByThisRun = true
      },
    },
    booking,
  })
  const tools = config.maxToolCalls === 0 ? [] : declarationsFor(config.enabledTools, bookingMode)
  const offered = offeredTools(config.enabledTools, bookingMode)
  const offersProposal = tools.length > 0 && (offered.includes('propose_booking') || offered.includes('propose_booking_change'))
  // R15/R22: tell the model a read-back is waiting (kind only); a failed read just leaves the line out.
  const pending = offersProposal && booking ? await booking.proposals.peekKind(key).catch(() => null) : null
  const started = Date.now()
  const result = await deps.model.respond({
    model,
    fallbackModel: effectiveFallbackModel(config, deps.envFallbackModel),
    systemInstruction: buildSystemInstruction(config, now, pending),
    history: toAgentTurns(rows),
    // No tool calls allowed → declare none, so the model answers in text (a points question included).
    tools,
    executeTool,
    temperature: config.temperature,
    maxOutputTokens: config.maxOutputTokens,
    maxToolCalls: config.maxToolCalls,
    perCallTimeoutMs: config.perCallTimeoutMs,
    budgetMs: JOB_BUDGET_MS,
  })
  return { result, latencyMs: Date.now() - started }
}

/**
 * The model call takes seconds and jobs of one conversation overlap, so the
 * start-of-job checks are repeated before anything is sent or drafted: a
 * newer diner message (its own job answers both) or a handoff silence set by
 * another job meanwhile stops this one.
 */
async function interruptedAfterCall(run: Run): Promise<'superseded' | 'silenced' | null> {
  const { deps, job, key } = run
  const [latest, silenced] = await Promise.all([
    deps.messages.latestUserMessageId(key),
    run.silencedByThisRun ? Promise.resolve(false) : deps.silences.isSilenced(key, deps.now().toISOString()),
  ])
  if (latest !== job.messageRowId) return 'superseded'
  return silenced ? 'silenced' : null
}

/** The model's answer bounded for sending, or the failure that replaces it (R10: empty → failure). */
function boundResult(result: AgentModelResult, config: AgentConfig): { reply: string } | { reason: AgentModelFailure } {
  if (!result.ok) return { reason: result.reason }
  const reply = boundReply(result.text, config.maxReplyChars, config.disclosureText)
  return reply ? { reply } : { reason: 'empty' }
}

/**
 * R4 + R19: an agent failure on an auto-admitted message. Claims the answer
 * row first (`handoff` with its text, or `fallback`), then sends the handoff
 * reply or the menu once; a handoff that did not go out becomes the menu, and
 * `error` when nothing went out. Null: duplicate run.
 */
async function fallBack(run: Run, record: RunRecord): Promise<RunRecord | null> {
  const handoff = run.failureAction === 'handoff' ? await run.handoffText() : null
  const claimed: RunRecord = handoff ? { ...record, outcome: 'handoff', text: handoff } : { ...record, outcome: 'fallback' }
  if (!(await run.claim(claimed))) return null
  if (handoff && (await run.sendHandoff(handoff))) return claimed
  return (await run.fallback()) ? { ...claimed, outcome: 'fallback' } : { ...claimed, outcome: 'error' }
}

async function deliver(
  run: Run,
  config: AgentConfig,
  base: Omit<RunRecord, 'outcome' | 'text'>,
  reply: string
): Promise<RunRecord | null> {
  const { deps, key } = run
  if (!(await deps.isWindowOpen(key))) return { ...base, outcome: 'skipped', text: reply, reason: 'window_closed' }
  const phoneNumberId = await deps.getPhoneNumberId(key.restaurantId)
  // No fallback: the menu needs the same phone number id.
  if (!phoneNumberId) return { ...base, outcome: 'error', text: reply, reason: 'no_phone_number' }
  const sent: RunRecord = { ...base, outcome: 'sent', text: reply }
  if (!(await run.claim(sent))) return null
  const result = await deps.sendText(phoneNumberId, key.phone, withDisclosure(reply, config.disclosureText)).catch(() => null)
  if (result?.ok) {
    run.replySent = true
    return sent
  }
  // R4: the reply did not go out, so the diner gets the menu instead (it may fail too; recorded as error).
  const fellBack = await run.fallback()
  return { ...sent, outcome: fellBack ? 'fallback' : 'error', reason: 'send_failed' }
}

async function answer(run: Run, config: AgentConfig, mode: 'shadow' | 'auto'): Promise<RunRecord | null> {
  const model = effectiveAgentModel(config, run.deps.envModel)
  const { result, latencyMs } = await callModel(run, config, model)
  // R18: the model that actually answered (the fallback when it was used).
  const base = {
    model: result.model ?? model,
    latencyMs,
    toolCalls: result.toolCalls,
    usage: result.usage,
    ...(result.httpStatus !== undefined ? { httpStatus: result.httpStatus } : {}),
  }
  // The call counts toward the limits whatever happens next (`model` is set on every row below).
  const interrupted = await interruptedAfterCall(run)
  if (interrupted) {
    // Superseded: the newer job owns the response. Silenced: the menu, as the webhook's silenced path (R4).
    if (interrupted === 'silenced' && run.owesResponse) await run.fallback()
    return { ...base, outcome: 'skipped', text: null, reason: interrupted }
  }
  const bounded = boundResult(result, config)

  if ('reason' in bounded) {
    if (!run.owesResponse) return { ...base, outcome: 'error', text: null, reason: bounded.reason }
    return fallBack(run, { ...base, outcome: 'fallback', text: null, reason: bounded.reason })
  }
  if (mode === 'shadow') {
    const draft: RunRecord = { ...base, outcome: 'shadow_draft', text: bounded.reply }
    if (!(await run.claim(draft))) return null
    if (!run.owesResponse) return draft
    // Admitted under auto, switched to shadow since: the suppressed menu goes out now.
    await run.fallback()
    return { ...draft, reason: 'mode_changed' }
  }
  return deliver(run, config, base, bounded.reply)
}

async function settle(run: Run, record: RunRecord | null): Promise<AgentRunResult> {
  if (record) return run.finish(record)
  run.deps.log('info', 'agent.duplicate', { messageId: run.job.messageRowId, restaurantId: run.key.restaurantId })
  return 'duplicate'
}

async function process(run: Run): Promise<AgentRunResult> {
  const { deps, job, key } = run
  const latest = await deps.messages.latestUserMessageId(key)
  if (latest !== job.messageRowId) {
    deps.log('info', 'agent.superseded', { messageId: job.messageRowId, restaurantId: key.restaurantId })
    return 'superseded'
  }

  const read = await deps.getConfig(key.restaurantId)
  if (!read.ok) {
    if (!run.owesResponse) return run.finish(noModelCall('error', 'config_unavailable'))
    return settle(run, await fallBack(run, noModelCall('fallback', 'config_unavailable')))
  }
  const config = read.config
  run.config = config
  const mode = effectiveMode(job.admittedMode, config.mode)
  if (mode === 'off') {
    if (run.owesResponse) await run.fallback()
    return run.finish(skipped('mode_off'))
  }
  const now = deps.now()
  if (await deps.silences.isSilenced(key, now.toISOString())) {
    if (run.owesResponse) await run.fallback()
    return run.finish(skipped('silenced'))
  }

  if (await isOverReplyLimit(deps.messages, key, config, now)) {
    // recordRateLimited stores the row; finish() would store a second one.
    const first = await recordRateLimited(deps.messages, key, now)
    if (run.owesResponse && first) await run.fallback()
    deps.log('info', 'agent.reply', { messageId: job.messageRowId, restaurantId: key.restaurantId, outcome: 'rate_limited' })
    return 'rate_limited'
  }

  return settle(run, await answer(run, config, mode))
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
    if (run.owesResponse && !run.replySent) await run.respondToFailure().catch(() => undefined)
    return 'error'
  }
}
