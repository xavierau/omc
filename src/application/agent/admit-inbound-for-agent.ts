/**
 * AGENT-001 R1: the webhook side of the reply agent. Stores the diner's
 * text and enqueues a delayed job; it never calls the model.
 *
 * - mode off (or any error here) → today's fallback menu, unchanged.
 * - shadow → row + job, and the caller still sends the fallback menu.
 * - auto → row + job and no fallback, unless the phone is silenced by a
 *   handoff (fallback, no job) or over a reply limit (R6: fallback once per
 *   hour, then quiet, no job), or the enqueue failed (fallback).
 *
 * Logs carry ids and outcomes only, never the text or the phone (R8).
 */
import { cutChars, USER_TEXT_MAX_CHARS } from '@/domain/services/agent-reply-text'
import type { AgentConfig } from '@/domain/value-objects/agent-config'
import type { AgentMessageStore, AgentSilenceStore } from '@/domain/ports/agent-reply'
import { isOverReplyLimit, recordRateLimited } from './agent-limits'

export type AgentLogFn = (level: 'info' | 'warn' | 'error', event: string, data: Record<string, unknown>) => void

export interface AgentReplyJob {
  restaurantId: string
  phone: string
  /** The agent_messages user row this job answers (latest-wins key). */
  messageRowId: string
}

export interface AdmitAgentDeps {
  getConfig(restaurantId: string): Promise<AgentConfig>
  messages: AgentMessageStore
  silences: AgentSilenceStore
  enqueue(job: AgentReplyJob, delayMs: number): Promise<void>
  now(): Date
  log: AgentLogFn
}

export interface InboundAgentText {
  restaurantId: string
  phone: string
  wamid: string
  text: string
}

export type AdmitDecision =
  | { kind: 'off' }
  | { kind: 'queued'; mode: 'shadow' | 'auto' }
  | { kind: 'fallback'; reason: 'silenced' | 'rate_limited' | 'enqueue_failed' }
  | { kind: 'quiet' }
  | { kind: 'duplicate' }

/** Whether the webhook still sends today's fallback menu for this decision. */
export function admitSendsFallback(decision: AdmitDecision): boolean {
  if (decision.kind === 'off' || decision.kind === 'fallback') return true
  return decision.kind === 'queued' && decision.mode === 'shadow'
}

async function autoGate(deps: AdmitAgentDeps, msg: InboundAgentText, config: AgentConfig): Promise<AdmitDecision | null> {
  const key = { restaurantId: msg.restaurantId, phone: msg.phone }
  const now = deps.now()
  if (await deps.silences.isSilenced(key, now.toISOString())) return { kind: 'fallback', reason: 'silenced' }
  if (!(await isOverReplyLimit(deps.messages, key, config, now))) return null
  const first = await recordRateLimited(deps.messages, key, now)
  return first ? { kind: 'fallback', reason: 'rate_limited' } : { kind: 'quiet' }
}

async function storeAndEnqueue(deps: AdmitAgentDeps, msg: InboundAgentText, config: AgentConfig): Promise<AdmitDecision> {
  const mode = config.mode as 'shadow' | 'auto'
  const inserted = await deps.messages.insertUserMessage({
    restaurantId: msg.restaurantId,
    phone: msg.phone,
    wamid: msg.wamid,
    text: cutChars(msg.text, USER_TEXT_MAX_CHARS),
  })
  if (inserted.kind === 'duplicate') return { kind: 'duplicate' }
  try {
    await deps.enqueue({ restaurantId: msg.restaurantId, phone: msg.phone, messageRowId: inserted.id }, config.debounceMs)
  } catch (err) {
    deps.log('warn', 'agent.enqueue_failed', { messageId: msg.wamid, errorClass: (err as Error)?.name ?? 'unknown' })
    return { kind: 'fallback', reason: 'enqueue_failed' }
  }
  return { kind: 'queued', mode }
}

async function decide(deps: AdmitAgentDeps, msg: InboundAgentText): Promise<AdmitDecision> {
  if (msg.text.trim() === '') return { kind: 'off' }
  const config = await deps.getConfig(msg.restaurantId)
  if (config.mode === 'off') return { kind: 'off' }
  if (config.mode === 'auto') {
    const gated = await autoGate(deps, msg, config)
    if (gated) return gated
  }
  return storeAndEnqueue(deps, msg, config)
}

export async function admitInboundForAgent(deps: AdmitAgentDeps, msg: InboundAgentText): Promise<AdmitDecision> {
  let decision: AdmitDecision
  try {
    decision = await decide(deps, msg)
  } catch (err) {
    // Fail toward today's behaviour: the diner gets the fallback menu.
    deps.log('warn', 'agent.admit_failed', { messageId: msg.wamid, errorClass: (err as Error)?.name ?? 'unknown' })
    return { kind: 'off' }
  }
  if (decision.kind !== 'off') {
    deps.log('info', 'agent.admitted', { messageId: msg.wamid, restaurantId: msg.restaurantId, decision: decision.kind })
  }
  return decision
}
