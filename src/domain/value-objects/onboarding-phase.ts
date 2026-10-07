// WONB-001: phase lattice setup -> probe -> build -> scale -> full -> steady.
// The phase value throttles broadcast aggressiveness (see playbook §1).
// `nextPhase(path, current)` is path-aware so future paths can deviate;
// in WONB-001 every path shares the linear order.

import type { OnboardingPath } from './onboarding-path'

export type OnboardingPhase =
  | 'setup'
  | 'probe'
  | 'build'
  | 'scale'
  | 'full'
  | 'steady'

export const ONBOARDING_PHASES: readonly OnboardingPhase[] = Object.freeze([
  'setup',
  'probe',
  'build',
  'scale',
  'full',
  'steady',
])

export function isOnboardingPhase(value: unknown): value is OnboardingPhase {
  return (
    typeof value === 'string' &&
    (ONBOARDING_PHASES as readonly string[]).includes(value)
  )
}

export function nextPhase(
  _path: OnboardingPath,
  current: OnboardingPhase
): OnboardingPhase | null {
  const idx = ONBOARDING_PHASES.indexOf(current)
  if (idx < 0 || idx >= ONBOARDING_PHASES.length - 1) return null
  return ONBOARDING_PHASES[idx + 1]
}

export function isAdvanceLegal(
  path: OnboardingPath,
  from: OnboardingPhase,
  to: OnboardingPhase
): boolean {
  return nextPhase(path, from) === to
}
