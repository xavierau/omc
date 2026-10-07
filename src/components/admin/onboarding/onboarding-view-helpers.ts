import {
  ONBOARDING_PHASES,
  type OnboardingPhase,
} from '@/domain/value-objects/onboarding-phase'
import type { ChecklistItem } from '@/domain/value-objects/pre-kickoff-checklist'
import type {
  BlockedReason,
  KpiGateView,
  OnboardingStateView,
} from '@/hooks/use-admin-tenant-onboarding'

export type PhaseStepStatus = 'done' | 'current' | 'upcoming'
export type KpiTileVariant = 'pass' | 'fail' | 'insufficient'
export type KpiMetric = 'delivery' | 'opt_out'

export function isPathSelectorDisabled(phase: OnboardingPhase): boolean {
  return phase !== 'setup'
}

export function isChecklistItemInteractive(item: ChecklistItem): boolean {
  return item.status !== 'not_applicable'
}

export function phaseStepStatus(
  view: OnboardingStateView,
  phase: OnboardingPhase
): PhaseStepStatus {
  const currentIdx = ONBOARDING_PHASES.indexOf(view.phase)
  const targetIdx = ONBOARDING_PHASES.indexOf(phase)
  if (targetIdx === currentIdx) return 'current'
  return targetIdx < currentIdx ? 'done' : 'upcoming'
}

export function kpiTileVariant(
  gate: KpiGateView,
  metric: KpiMetric
): KpiTileVariant {
  if (gate.status === 'insufficient') return 'insufficient'
  if (gate.status === 'pass') return 'pass'
  return gate.failingMetrics.includes(metric) ? 'fail' : 'pass'
}

export function blockedReasonI18nKey(reason: BlockedReason): string {
  return `advance.disabledReason.${reason}`
}
