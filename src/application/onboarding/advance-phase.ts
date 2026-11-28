// WONB-001: orchestrates a single one-step phase advance.
//
// Order of operations matters: cheapest fast-path failures (no path, terminal
// phase) are checked BEFORE the KPI evaluator round-trips Postgres. The KPI
// gate is the slowest dependency — skip it when we already know the entity
// will throw.

import { TenantOnboardingState } from '@/domain/entities/onboarding/tenant-onboarding-state'
import { OnboardingAdvanceError } from '@/domain/services/__errors__/onboarding-errors'
import type { OnboardingPhase } from '@/domain/value-objects/onboarding-phase'
import type { TenantOnboardingStateRepository } from '@/domain/repositories/tenant-onboarding-state-repository'
import type { KpiGateEvaluator, KpiGateResult } from '@/domain/ports/kpi-gate-evaluator'

export interface AdvancePhaseArgs {
  restaurantId: string
  actor: string
  repo: TenantOnboardingStateRepository
  kpiEvaluator: KpiGateEvaluator
}

export interface AdvancePhaseResult {
  state: TenantOnboardingState
  fromPhase: OnboardingPhase
  toPhase: OnboardingPhase
  kpiGate: KpiGateResult
}

export async function advancePhase(
  args: AdvancePhaseArgs
): Promise<AdvancePhaseResult> {
  const current = await loadState(args)
  assertAdvanceablePhase(current)
  const kpiGate = await args.kpiEvaluator.evaluate({
    restaurantId: args.restaurantId,
  })
  assertKpiPass(kpiGate)
  const fromPhase = current.snapshot.phase
  const next = current.advance({
    kpiPass: true,
    expectedFrom: fromPhase,
    actor: args.actor,
    now: new Date().toISOString(),
  })
  const persisted = await args.repo.advance(next, fromPhase)
  return { state: persisted, fromPhase, toPhase: persisted.snapshot.phase, kpiGate }
}

async function loadState(
  args: AdvancePhaseArgs
): Promise<TenantOnboardingState> {
  const current = await args.repo.findByRestaurantId(args.restaurantId)
  if (!current) {
    throw new Error(
      `advancePhase: state not found for restaurant ${args.restaurantId}`
    )
  }
  return current
}

function assertAdvanceablePhase(state: TenantOnboardingState): void {
  const { phase, onboardingPath } = state.snapshot
  if (phase === 'steady') throw new OnboardingAdvanceError('phase_terminal')
  if (onboardingPath === null) throw new OnboardingAdvanceError('no_path')
}

function assertKpiPass(gate: KpiGateResult): void {
  if (gate.status === 'pass') return
  if (gate.status === 'insufficient') {
    throw new OnboardingAdvanceError('kpi_insufficient')
  }
  throw new OnboardingAdvanceError('kpi_failed')
}
