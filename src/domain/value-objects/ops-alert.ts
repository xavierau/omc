// WAQ-013: domain value object for live ops alerts (Slack notifier, etc).
//
// The audit trail (events table + console.error) lives in WAQ-003's
// emit-ops-alert.ts. This VO + the WAQ-013 Slack notifier sit ON TOP of that
// trail to push live notifications to the right team.
//
// Routing policy (from WAQ-013 spec):
//   - CS team:       yellow transitions, recovery-pending, opt-out / throttle spikes.
//   - Platform team: red transitions, auto-pause, WABA tier changes, engineering alerts.
//   - Both:          policy violations + template blocks (CS coaches tenant, platform
//                    investigates WABA risk).

export type AlertKind =
  | 'quality_transition_yellow'
  | 'quality_transition_red'
  | 'quality_recovery_pending'
  | 'auto_pause_triggered'
  | 'pmm_throttle_spike'
  | 'opt_out_spike'
  | 'waba_tier_change'
  | 'policy_violation'
  | 'engineering_alert'
  | 'block_template'

export type AlertSeverity = 'info' | 'warn' | 'error' | 'critical'

export type AlertChannel = 'cs' | 'platform' | 'both'

export interface OpsAlert {
  kind: AlertKind
  severity: AlertSeverity
  restaurantId: string
  restaurantName?: string
  message: string
  details?: Record<string, unknown>
}

const CS_KINDS: ReadonlySet<AlertKind> = new Set([
  'quality_transition_yellow',
  'quality_recovery_pending',
  'opt_out_spike',
  'pmm_throttle_spike',
])

const PLATFORM_KINDS: ReadonlySet<AlertKind> = new Set([
  'quality_transition_red',
  'auto_pause_triggered',
  'waba_tier_change',
  'engineering_alert',
])

const BOTH_KINDS: ReadonlySet<AlertKind> = new Set([
  'policy_violation',
  'block_template',
])

export function routingFor(alert: OpsAlert): AlertChannel {
  if (BOTH_KINDS.has(alert.kind)) return 'both'
  if (PLATFORM_KINDS.has(alert.kind)) return 'platform'
  if (CS_KINDS.has(alert.kind)) return 'cs'
  // Defensive default: route unknown kinds to platform for triage.
  return 'platform'
}
