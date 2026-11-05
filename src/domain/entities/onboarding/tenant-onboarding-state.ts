import type { OnboardingPath } from '@/domain/value-objects/onboarding-path'
import {
  type OnboardingPhase,
  isAdvanceLegal,
  nextPhase,
} from '@/domain/value-objects/onboarding-phase'
import {
  type ChecklistKey,
  type PreKickoffChecklist,
  applyTick,
  applyUntick,
  buildInitialChecklist,
  isChecklistComplete,
} from '@/domain/value-objects/pre-kickoff-checklist'
import {
  ConcurrentAdvanceError,
  OnboardingAdvanceError,
  OnboardingPathLockedError,
  OnboardingPathRequiredError,
  OnboardingTerminalError,
} from '@/domain/services/__errors__/onboarding-errors'

export { ConcurrentAdvanceError }

export interface TenantOnboardingStateProps {
  readonly id: string
  readonly restaurantId: string
  readonly onboardingPath: OnboardingPath | null
  readonly phase: OnboardingPhase
  readonly checklist: PreKickoffChecklist
  readonly advancedAt: string | null
  readonly advancedBy: string | null
  readonly createdAt: string
  readonly updatedAt: string
}

export interface CreateDefaultInput {
  id: string
  restaurantId: string
  now: string
}

export interface AdvanceArgs {
  kpiPass: boolean
  expectedFrom: OnboardingPhase
  actor: string
  now: string
}

export class TenantOnboardingState {
  private constructor(private readonly props: TenantOnboardingStateProps) {}

  static createDefault(input: CreateDefaultInput): TenantOnboardingState {
    return new TenantOnboardingState({
      id: input.id,
      restaurantId: input.restaurantId,
      onboardingPath: null,
      phase: 'setup',
      checklist: buildInitialChecklist(null),
      advancedAt: null,
      advancedBy: null,
      createdAt: input.now,
      updatedAt: input.now,
    })
  }

  static fromProps(props: TenantOnboardingStateProps): TenantOnboardingState {
    return new TenantOnboardingState(props)
  }

  get snapshot(): TenantOnboardingStateProps {
    return this.props
  }

  setPath(path: OnboardingPath, now: string): TenantOnboardingState {
    if (this.props.phase !== 'setup') throw new OnboardingPathLockedError()
    return new TenantOnboardingState({
      ...this.props,
      onboardingPath: path,
      checklist: rebuildChecklistPreservingTicks(this.props.checklist, path),
      updatedAt: now,
    })
  }

  tickChecklist(
    key: ChecklistKey,
    actor: string,
    now: string
  ): TenantOnboardingState {
    return new TenantOnboardingState({
      ...this.props,
      checklist: applyTick(this.props.checklist, key, { actor, now }),
      updatedAt: now,
    })
  }

  untickChecklist(key: ChecklistKey, now: string): TenantOnboardingState {
    return new TenantOnboardingState({
      ...this.props,
      checklist: applyUntick(this.props.checklist, key),
      updatedAt: now,
    })
  }

  advance(args: AdvanceArgs): TenantOnboardingState {
    const { phase, onboardingPath } = this.props
    if (phase === 'steady') throw new OnboardingTerminalError()
    if (onboardingPath === null) throw new OnboardingPathRequiredError()
    if (args.expectedFrom !== phase) {
      throw new OnboardingAdvanceError('illegal_transition')
    }
    const target = nextPhase(onboardingPath, phase)
    if (target === null || !isAdvanceLegal(onboardingPath, phase, target)) {
      throw new OnboardingAdvanceError('illegal_transition')
    }
    if (phase === 'setup' && !isChecklistComplete(this.props.checklist)) {
      throw new OnboardingAdvanceError('checklist_incomplete')
    }
    if (!args.kpiPass) throw new OnboardingAdvanceError('kpi_failed')
    return new TenantOnboardingState({
      ...this.props,
      phase: target,
      advancedAt: args.now,
      advancedBy: args.actor,
      updatedAt: args.now,
    })
  }
}

function rebuildChecklistPreservingTicks(
  prior: PreKickoffChecklist,
  nextPath: OnboardingPath
): PreKickoffChecklist {
  const fresh = buildInitialChecklist(nextPath)
  const out: Partial<Record<ChecklistKey, typeof fresh[ChecklistKey]>> = {}
  for (const key of Object.keys(fresh) as ChecklistKey[]) {
    const f = fresh[key]
    const p = prior[key]
    out[key] =
      f.status === 'not_applicable' || !p || p.status === 'not_applicable'
        ? f
        : p
  }
  return Object.freeze(out as PreKickoffChecklist)
}
