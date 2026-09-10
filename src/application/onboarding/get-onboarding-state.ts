// WONB-001: assemble the derived OnboardingStateView the UI consumes.
// Auto-initializes the row when missing (Q1). Computes canAdvance + blocked
// reasons here so the UI never re-derives policy.

import type { TenantOnboardingState } from '@/domain/entities/onboarding/tenant-onboarding-state'
import type { OnboardingPath } from '@/domain/value-objects/onboarding-path'
import type { OnboardingPhase } from '@/domain/value-objects/onboarding-phase'
import { nextPhase } from '@/domain/value-objects/onboarding-phase'
import type {
  PreKickoffChecklist,
} from '@/domain/value-objects/pre-kickoff-checklist'
import { isChecklistComplete } from '@/domain/value-objects/pre-kickoff-checklist'
import type {
  KpiGateEvaluator,
  KpiGateResult,
} from '@/domain/ports/kpi-gate-evaluator'
import type { TenantOnboardingStateRepository } from '@/domain/repositories/tenant-onboarding-state-repository'
import { initializeOnboardingState } from './initialize-onboarding-state'

export type BlockedReason =
  | 'checklist_incomplete'
  | 'kpi_failed'
  | 'kpi_insufficient'
  | 'phase_terminal'
  | 'no_path'

export type KpiGateView =
  | { status: 'pass'; deliveryRate: number; optOutRate: number; sampleSize: number }
  | {
      status: 'fail'
      deliveryRate: number
      optOutRate: number
      sampleSize: number
      failingMetrics: ('delivery' | 'opt_out')[]
    }
  | { status: 'insufficient'; observed: number; required: number }

export interface OnboardingStateView {
  readonly restaurantId: string
  readonly path: OnboardingPath | null
  readonly phase: OnboardingPhase
  readonly checklist: PreKickoffChecklist
  readonly kpiGate: KpiGateView
  readonly checklistComplete: boolean
  readonly nextPhase: OnboardingPhase | null
  readonly canAdvance: boolean
  readonly blockedReasons: readonly BlockedReason[]
}

export interface GetOnboardingStateArgs {
  restaurantId: string
  repo: TenantOnboardingStateRepository
  kpiEvaluator: KpiGateEvaluator
}

export async function getOnboardingState(
  args: GetOnboardingStateArgs
): Promise<OnboardingStateView> {
  const state = await initializeOnboardingState({
    restaurantId: args.restaurantId,
    repo: args.repo,
  })
  const gate = await args.kpiEvaluator.evaluate({ restaurantId: args.restaurantId })
  return buildView(state, gate)
}

export function buildView(
  state: TenantOnboardingState,
  gate: KpiGateResult
): OnboardingStateView {
  const s = state.snapshot
  const checklistComplete = isChecklistComplete(s.checklist)
  const np = s.onboardingPath ? nextPhase(s.onboardingPath, s.phase) : null
  const blockedReasons = computeBlockedReasons(s.phase, s.onboardingPath, checklistComplete, gate)
  return {
    restaurantId: s.restaurantId,
    path: s.onboardingPath,
    phase: s.phase,
    checklist: s.checklist,
    kpiGate: toKpiGateView(gate),
    checklistComplete,
    nextPhase: np,
    canAdvance: blockedReasons.length === 0,
    blockedReasons,
  }
}

function computeBlockedReasons(
  phase: OnboardingPhase,
  path: OnboardingPath | null,
  checklistComplete: boolean,
  gate: KpiGateResult
): readonly BlockedReason[] {
  const reasons: BlockedReason[] = []
  if (phase === 'steady') reasons.push('phase_terminal')
  if (path === null) reasons.push('no_path')
  if (phase === 'setup' && !checklistComplete) reasons.push('checklist_incomplete')
  if (gate.status === 'fail') reasons.push('kpi_failed')
  if (gate.status === 'insufficient') reasons.push('kpi_insufficient')
  return reasons
}

function toKpiGateView(gate: KpiGateResult): KpiGateView {
  if (gate.status === 'insufficient') {
    return {
      status: 'insufficient',
      observed: gate.kpis.totalSends,
      required: gate.thresholds.minSampleSize,
    }
  }
  const base = {
    deliveryRate: gate.kpis.deliveryRate,
    optOutRate: gate.kpis.optOutRate,
    sampleSize: gate.kpis.totalSends,
  }
  if (gate.status === 'pass') return { status: 'pass', ...base }
  return { status: 'fail', ...base, failingMetrics: [...gate.failingMetrics] }
}
