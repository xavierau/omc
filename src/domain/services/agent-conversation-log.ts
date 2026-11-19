/**
 * AGENT-001 W2: the dashboard conversation log (R7).
 *
 * A thread is one diner's conversation with the agent. Its key is the id of
 * the thread's newest row: opaque (a UUID, never the phone) and resolved back
 * to the phone server-side, inside the admin's tenant only. The phone leaves
 * the server masked to its last four digits.
 */
import type { AgentOutcome } from '@/domain/ports/agent-reply'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isAgentThreadKey(value: string): boolean {
  return UUID_PATTERN.test(value)
}

export function maskAgentPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  return `•••• ${digits.slice(-4)}`
}

export interface AgentLogRow {
  id: string
  phone: string
  role: 'user' | 'model'
  outcome: AgentOutcome | null
  createdAt: string
}

export interface AgentThreadSummary {
  key: string
  maskedPhone: string
  lastActivityAt: string
  messageCount: number
  latestOutcome: AgentOutcome | null
}

/** `rows` newest first (as the repository returns them); threads come out newest activity first. */
export function summarizeAgentThreads(rows: AgentLogRow[]): AgentThreadSummary[] {
  const threads = new Map<string, AgentThreadSummary>()
  for (const row of rows) {
    const thread = threads.get(row.phone)
    if (!thread) {
      threads.set(row.phone, {
        key: row.id,
        maskedPhone: maskAgentPhone(row.phone),
        lastActivityAt: row.createdAt,
        messageCount: 1,
        latestOutcome: row.role === 'model' ? row.outcome : null,
      })
      continue
    }
    thread.messageCount += 1
    if (thread.latestOutcome === null && row.role === 'model') thread.latestOutcome = row.outcome
  }
  return [...threads.values()]
}

export interface AgentThreadMessage {
  id: string
  role: 'user' | 'model'
  text: string | null
  outcome: AgentOutcome | null
  model: string | null
  latencyMs: number | null
  toolCalls: string[]
  createdAt: string
}
