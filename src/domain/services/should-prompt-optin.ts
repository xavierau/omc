import type { ConsentRecord } from '@/domain/entities/consent-record'

export type SkipReason =
  | 'system_keyword'
  | 'no_member'
  | 'has_strong_consent'
  | 'opted_out'
  | 'recent_pending'

export interface ShouldPromptInput {
  existingMember: { id: string } | null
  activeMarketingConsent: ConsentRecord | null
  recentPendingConsent: ConsentRecord | null
  isSystemKeyword: boolean
  now?: Date
}

export interface ShouldPromptResult {
  prompt: boolean
  reason?: SkipReason
}

/**
 * Cooldown after a pending opt-in row is captured. Inbounds within this
 * window do NOT re-prompt — exported so the repository's `withinMs`
 * default and this domain check share a single source of truth.
 */
export const PENDING_OPTIN_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000

/**
 * WONB-007 gate: returns `{ prompt: true }` only when an inbound from a
 * member without active strong-marketing-consent should trigger the
 * confirmation template. Pure: zero I/O.
 */
export function shouldPromptOptin(
  input: ShouldPromptInput
): ShouldPromptResult {
  if (input.isSystemKeyword) return skip('system_keyword')
  if (!input.existingMember) return skip('no_member')

  const consent = input.activeMarketingConsent?.snapshot
  if (consent?.status === 'opted_in' && consent.consentGrade === 'strong') {
    return skip('has_strong_consent')
  }
  if (consent?.status === 'opted_out') return skip('opted_out')

  if (isRecentPending(input.recentPendingConsent, input.now ?? new Date())) {
    return skip('recent_pending')
  }
  return { prompt: true }
}

function isRecentPending(
  pending: ConsentRecord | null,
  now: Date
): boolean {
  if (!pending) return false
  const capturedAt = Date.parse(pending.snapshot.capturedAt)
  if (!Number.isFinite(capturedAt)) return false
  return now.getTime() - capturedAt < PENDING_OPTIN_COOLDOWN_MS
}

function skip(reason: SkipReason): ShouldPromptResult {
  return { prompt: false, reason }
}
