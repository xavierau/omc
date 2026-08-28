/**
 * Action taken when a WhatsApp send fails with a given Meta error code.
 *
 * The full §6.1 dispatch table is implemented below. The dispatcher in
 * `src/application/dispatch-error-action.ts` routes against the returned
 * `action`; member-state mutations (`pmm_throttled_until`, `unreachable_at`)
 * fire only for `throttle_recipient_24h` and `mark_recipient_unreachable`.
 *
 * `internal_orphan` is forensic noise from the orphan-reconciliation sweep
 * (see `application/reconcile-orphan-messages.ts`). It MUST stay on
 * `log_only` so the dispatcher does not mutate any member state for rows
 * the sweep flipped — Meta may still have delivered the message; we only
 * lost track of the wamid.
 */
export type ErrorAction =
  | 'throttle_recipient_24h' // 131049
  | 'mark_recipient_unreachable' // 131026
  | 'block_template' // 131045
  | 'reduce_batch_size' // 131048
  | 'backoff_and_retry' // 131056
  | 'log_only' // 131047, internal_orphan
  | 'engineering_alert' // 131051, unknown
  | 'policy_violation_alert' // 132xxx

export type ErrorSeverity = 'info' | 'warn' | 'error' | 'critical'

export interface ErrorClassification {
  code: string
  action: ErrorAction
  severity: ErrorSeverity
}

interface TableEntry {
  action: ErrorAction
  severity: ErrorSeverity
}

const TABLE: Record<string, TableEntry> = {
  '131049': { action: 'throttle_recipient_24h', severity: 'warn' },
  '131026': { action: 'mark_recipient_unreachable', severity: 'warn' },
  '131045': { action: 'block_template', severity: 'error' },
  // Billing / eligibility (WABA currency not configured). Tenant-visible via
  // the campaign failure_reason (#131) — NOT an engineering alert, which
  // would post to Slack once per failed message of a whole campaign.
  '131042': { action: 'log_only', severity: 'error' },
  '131047': { action: 'log_only', severity: 'info' },
  '131048': { action: 'reduce_batch_size', severity: 'warn' },
  '131051': { action: 'engineering_alert', severity: 'error' },
  '131056': { action: 'backoff_and_retry', severity: 'warn' },
  internal_orphan: { action: 'log_only', severity: 'warn' },
}

/**
 * Maps a Meta error code to the action the dispatcher should take.
 *
 * Lookup order:
 *   1. Exact match in TABLE (covers the §6.1 codes + `internal_orphan`).
 *   2. `132xxx` prefix → policy_violation_alert / critical.
 *   3. Default → engineering_alert / error (logged + ops-alerted).
 */
export function classifyErrorCode(code: string | null): ErrorClassification {
  const normalized = code ?? 'unknown'
  const exact = TABLE[normalized]
  if (exact) return { code: normalized, ...exact }
  if (normalized.startsWith('132')) {
    return {
      code: normalized,
      action: 'policy_violation_alert',
      severity: 'critical',
    }
  }
  return {
    code: normalized,
    action: 'engineering_alert',
    severity: 'error',
  }
}
