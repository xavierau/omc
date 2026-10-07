// Cap-policy evaluation (plan §9, FOUNDER DECISION 2026-06-10). The per-campaign
// max_stamps_per_day knob is owner-configurable; the GUARDRAIL on raising it is
// itself a platform-admin-configurable policy. This pure function decides what
// happens when an owner sets max_stamps_per_day above the warn threshold:
//   off   → allow silently
//   warn  → allow, but surface the forwarded-screenshot abuse-risk warning (R-FWD)
//   block → reject with a plan-limit error
// The apply_stamp RPC always honors whatever max_stamps_per_day is persisted; this
// only governs the campaign editor's save path.

export type StampCapEnforcement = 'off' | 'warn' | 'block'

export interface StampCapPolicy {
  enforcement: StampCapEnforcement
  warnThreshold: number
}

export interface StampCapDecision {
  allowed: boolean
  warning?: string
  error?: string
}

const WARN_MESSAGE =
  'Raising the daily cap widens the forwarded-screenshot abuse risk. ' +
  'Each member can now earn more than one stamp per day.'

export function evaluateStampCapPolicy(
  maxStampsPerDay: number,
  policy: StampCapPolicy
): StampCapDecision {
  if (maxStampsPerDay <= policy.warnThreshold) return { allowed: true }
  if (policy.enforcement === 'block') {
    return {
      allowed: false,
      error: `Your plan limits stamps to ${policy.warnThreshold}/day.`,
    }
  }
  if (policy.enforcement === 'warn') {
    return { allowed: true, warning: WARN_MESSAGE }
  }
  return { allowed: true }
}
