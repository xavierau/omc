// WAQ-013: maps a QualityAction (from the dispatcher) to the OpsAlert(s)
// that should be sent to Slack. Pure function — extracted from the
// dispatcher to keep `dispatch-quality-action.ts` focused on side effects.
//
// Pause emits TWO alerts: `quality_transition_red` (for the platform team
// to see the state change) AND `auto_pause_triggered` (the actionable
// platform-team escalation). Both route to platform per `routingFor`.

import type { QualityAction } from '@/domain/value-objects/quality-action'
import type { QualityRating } from '@/domain/value-objects/quality-rating'
import type { OpsAlert } from '@/domain/value-objects/ops-alert'

export interface BuildQualityAlertsInput {
  restaurantId: string
  prevRating: QualityRating | null
  nextRating: QualityRating
}

export function buildQualityAlerts(
  input: BuildQualityAlertsInput,
  action: QualityAction
): OpsAlert[] {
  if (action.kind === 'throttle') return [throttleAlert(input)]
  if (action.kind === 'pause') return pauseAlerts(input)
  if (action.kind === 'manual_recovery_required') {
    return [recoveryAlert(input)]
  }
  return []
}

function throttleAlert(input: BuildQualityAlertsInput): OpsAlert {
  return {
    kind: 'quality_transition_yellow',
    severity: 'warn',
    restaurantId: input.restaurantId,
    message: `Quality dropped to YELLOW (was ${input.prevRating ?? 'null'}). Auto-throttle active.`,
    details: {
      prevRating: input.prevRating,
      nextRating: input.nextRating,
    },
  }
}

function pauseAlerts(input: BuildQualityAlertsInput): OpsAlert[] {
  return [redTransitionAlert(input), autoPauseAlert(input)]
}

function redTransitionAlert(input: BuildQualityAlertsInput): OpsAlert {
  return {
    kind: 'quality_transition_red',
    severity: 'critical',
    restaurantId: input.restaurantId,
    message: `Quality dropped to RED (was ${input.prevRating ?? 'null'}).`,
    details: {
      prevRating: input.prevRating,
      nextRating: input.nextRating,
    },
  }
}

function autoPauseAlert(input: BuildQualityAlertsInput): OpsAlert {
  return {
    kind: 'auto_pause_triggered',
    severity: 'critical',
    restaurantId: input.restaurantId,
    message: 'Tenant campaigns auto-paused.',
    details: {
      prevRating: input.prevRating,
      nextRating: input.nextRating,
      reason: 'quality_red_auto',
    },
  }
}

function recoveryAlert(input: BuildQualityAlertsInput): OpsAlert {
  return {
    kind: 'quality_recovery_pending',
    severity: 'info',
    restaurantId: input.restaurantId,
    message: `Quality recovered to ${input.nextRating} (was ${input.prevRating ?? 'null'}). Manual clear required.`,
    details: {
      prevRating: input.prevRating,
      nextRating: input.nextRating,
    },
  }
}
