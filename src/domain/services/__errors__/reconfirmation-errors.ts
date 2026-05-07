// WONB-008: typed error vocabulary for the re-confirmation campaign
// (Strategy B). API routes map each `name` to an HTTP status + machine-
// readable reason for the dashboard dialog.

import type { QualityStateEvent } from '@/domain/entities/quality-state-event'

export type ReconfirmationEligibilityViolationKey =
  | 'quality_not_green'
  | 'empty_audience'
  | 'daily_cap_met'
  | 'auto_paused'

export interface ReconfirmationEligibilityViolation {
  key: ReconfirmationEligibilityViolationKey
  detail?: string
}

export class ReconfirmationEligibilityError extends Error {
  constructor(
    public readonly violations: ReconfirmationEligibilityViolation[]
  ) {
    super(
      `reconfirmation_not_eligible: ${violations.map((v) => v.key).join(',')}`
    )
    this.name = 'ReconfirmationEligibilityError'
  }
}

export type ReconfirmationTemplateReason = 'not_utility' | 'not_approved'

export class ReconfirmationTemplateError extends Error {
  constructor(public readonly reason: ReconfirmationTemplateReason) {
    super(`reconfirmation_template_${reason}`)
    this.name = 'ReconfirmationTemplateError'
  }
}

// Stream D parses violation.detail as `<STATE> since <YYYY-MM-DD>`. Falls back
// to "UNKNOWN since unknown" when no event row exists (fail-safe display
// rather than a missing string).
export function formatQualityDetail(event: QualityStateEvent | null): string {
  if (!event) return 'UNKNOWN since unknown'
  const { qualityRating, transitionedAt } = event.snapshot
  return `${qualityRating} since ${transitionedAt.slice(0, 10)}`
}
