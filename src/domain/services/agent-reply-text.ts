/**
 * AGENT-001: pure text rules of the reply agent.
 *
 * - R10: the model's reply is bounded so the WHOLE message the diner gets
 *   (reply + blank line + disclosure) fits in `maxReplyChars`. Shadow drafts
 *   use the same budget, so a draft is exactly what auto would have sent.
 * - R11: auto replies always end with the disclosure.
 * - History rows become Gemini turns: consecutive rows of one role merge, and
 *   the conversation must start with the diner.
 */
import type { AgentTurn } from '@/domain/ports/agent-model'
import type { AgentHistoryMessage } from '@/domain/ports/agent-reply'

export const DISCLOSURE_SEPARATOR = '\n\n'
/** A user row's stored text is cut here (the model never needs more). */
export const USER_TEXT_MAX_CHARS = 2000

/** Cuts by code point, so an emoji or CJK surrogate pair is never split. */
export function cutChars(text: string, max: number): string {
  const chars = Array.from(text)
  return chars.length <= max ? text : chars.slice(0, max).join('')
}

const charLength = (text: string) => Array.from(text).length

/** Room left for the reply once the disclosure footer is reserved. */
export function replyBudget(maxReplyChars: number, disclosureText: string): number {
  return Math.max(0, maxReplyChars - charLength(DISCLOSURE_SEPARATOR) - charLength(disclosureText))
}

/** The trimmed reply, or '' when nothing is left (an `empty` failure, R4). */
export function boundReply(text: string, maxReplyChars: number, disclosureText: string): string {
  return cutChars(text.trim(), replyBudget(maxReplyChars, disclosureText)).trim()
}

export function withDisclosure(reply: string, disclosureText: string): string {
  return `${reply}${DISCLOSURE_SEPARATOR}${disclosureText}`
}

/** Chronological rows → alternating turns that start with the diner. */
export function toAgentTurns(rows: AgentHistoryMessage[]): AgentTurn[] {
  const turns: AgentTurn[] = []
  for (const row of rows) {
    if (turns.length === 0 && row.role === 'model') continue
    const last = turns[turns.length - 1]
    if (last && last.role === row.role) last.text = `${last.text}\n${row.text}`
    else turns.push({ role: row.role, text: row.text })
  }
  return turns
}
