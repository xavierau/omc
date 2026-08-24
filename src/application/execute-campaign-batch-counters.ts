// Skip-reason counters for the campaign batch path. Extracted from
// `execute-campaign-batch.ts` so the orchestrator stays under the file-size
// limit and the tally logic can evolve independently of the send loop.

import type { SkipDecision } from '@/domain/value-objects/marketing-skip-reason'

export type MemberOutcome =
  | 'sent'
  | 'skipped_no_consent'
  | 'skipped_cap_exceeded'
  | 'skipped_throttled'
  | 'skipped_unreachable'

export interface SkipCounters {
  // #127 / CAMP-007: successful sends are counted too, so the orchestrator
  // can tell an all-failed run (failed > 0, sent === 0) from a partial one.
  sent: number
  failed: number
  noConsent: number
  capExceeded: number
  throttled: number
  unreachable: number
}

export function emptyCounters(): SkipCounters {
  return {
    sent: 0,
    failed: 0,
    noConsent: 0,
    capExceeded: 0,
    throttled: 0,
    unreachable: 0,
  }
}

export function outcomeFromDecision(
  decision: SkipDecision | undefined
): MemberOutcome | 'allowed' {
  // Defaults to denied if the map is missing the phone — defence in depth
  // against a gate-loader that skipped the recipient entirely.
  if (!decision) return 'skipped_no_consent'
  if (decision.allowed) return 'allowed'
  switch (decision.reason) {
    case 'pmm_throttled':
      return 'skipped_throttled'
    case 'cap_exceeded':
      return 'skipped_cap_exceeded'
    case 'unreachable':
      return 'skipped_unreachable'
    default:
      return 'skipped_no_consent'
  }
}

export function tally(
  results: Array<PromiseSettledResult<MemberOutcome>>,
  counters: SkipCounters
): void {
  for (const r of results) {
    if (r.status === 'rejected') {
      counters.failed++
      console.error('[Campaign] Member send failed:', r.reason)
      continue
    }
    if (r.value === 'sent') counters.sent++
    else if (r.value === 'skipped_no_consent') counters.noConsent++
    else if (r.value === 'skipped_cap_exceeded') counters.capExceeded++
    else if (r.value === 'skipped_throttled') counters.throttled++
    else if (r.value === 'skipped_unreachable') counters.unreachable++
  }
}

export function logSummary(total: number, c: SkipCounters): void {
  if (c.failed > 0) console.warn(`[Campaign] ${c.failed}/${total} sends failed`)
  if (c.noConsent > 0) {
    console.warn(`[Campaign] ${c.noConsent}/${total} skipped (no consent)`)
  }
  if (c.capExceeded > 0) {
    console.warn(`[Campaign] ${c.capExceeded}/${total} skipped (cap exceeded)`)
  }
  if (c.throttled > 0) {
    console.warn(`[Campaign] ${c.throttled}/${total} skipped (PMM throttled)`)
  }
  if (c.unreachable > 0) {
    console.warn(`[Campaign] ${c.unreachable}/${total} skipped (unreachable)`)
  }
}
