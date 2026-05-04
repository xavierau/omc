/**
 * Action taken when a WhatsApp send fails with a given Meta error code.
 *
 * The full code -> action table is owned by WAQ-003. WAQ-001 only needs
 * the type surface (so the entity, repo, and reconciliation sweep can
 * reference it) plus a default + the `internal_orphan` entry consumed by
 * the reconciliation sweep helper. Other codes fall through to
 * `engineering_alert` for now.
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

export interface ErrorClassification {
  code: string
  action: ErrorAction
  severity: 'info' | 'warn' | 'error' | 'critical'
}

/**
 * Maps a Meta error code to the action the dispatcher should take.
 *
 * WAQ-001 implements only the entries this slice actually uses
 * (`internal_orphan` from the reconciliation sweep, plus the
 * default-`engineering_alert` fallback). WAQ-003 will populate the full
 * §6.1 table.
 */
export function classifyErrorCode(code: string | null): ErrorClassification {
  const normalized = code ?? 'unknown'
  if (normalized === 'internal_orphan') {
    return { code: normalized, action: 'log_only', severity: 'warn' }
  }
  return { code: normalized, action: 'engineering_alert', severity: 'error' }
}
