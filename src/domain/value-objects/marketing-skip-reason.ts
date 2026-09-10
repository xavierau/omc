// WAQ-007: structured skip reasons for the marketing send path.
//
// Two gates feed into the unified `SkipDecision`:
//   - WAQ-004 marketing-consent gate: 'no_consent' | 'opted_out' | 'pending'
//   - WAQ-007 cooldown gate:           'pmm_throttled' | 'cap_exceeded' | 'unreachable'
//
// Keeping the reason as a stable string union (rather than per-gate enums)
// gives downstream analytics/dashboards one column to bucket on. Adding a
// new reason here is intentionally a typed breaking change so every consumer
// (counters, logs, reports) is updated together.

export type MarketingSkipReason =
  | 'pmm_throttled' // members.pmm_throttled_until > now() (set by WAQ-003 on 131049)
  | 'cap_exceeded' // >= per_user_marketing_cap marketing sends in last 24h
  | 'unreachable' // members.unreachable_at IS NOT NULL (set by WAQ-003 on 131026)
  | 'no_consent' // no active consent record
  | 'opted_out' // consent record present but opted_out
  | 'pending' // consent record present but pending double-opt-in

export interface SkipDecision {
  allowed: boolean
  reason?: MarketingSkipReason
}
