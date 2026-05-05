// WONB-001: typed error vocabulary for the onboarding state machine.
// API routes map each `name` to an HTTP status + machine-readable reason.

export type OnboardingAdvanceReason =
  | 'checklist_incomplete'
  | 'kpi_failed'
  | 'kpi_insufficient'
  | 'phase_terminal'
  | 'illegal_transition'
  | 'no_path'

export class OnboardingAdvanceError extends Error {
  constructor(public readonly reason: OnboardingAdvanceReason, message?: string) {
    super(message ?? reason)
    this.name = 'OnboardingAdvanceError'
  }
}

export class ConcurrentAdvanceError extends Error {
  constructor(message = 'concurrent_advance') {
    super(message)
    this.name = 'ConcurrentAdvanceError'
  }
}

export class OnboardingPathLockedError extends Error {
  constructor(message = 'phase_locked') {
    super(message)
    this.name = 'OnboardingPathLockedError'
  }
}

export class OnboardingTerminalError extends Error {
  constructor(message = 'phase_terminal') {
    super(message)
    this.name = 'OnboardingTerminalError'
  }
}

export class OnboardingPathRequiredError extends Error {
  constructor(message = 'no_path') {
    super(message)
    this.name = 'OnboardingPathRequiredError'
  }
}
