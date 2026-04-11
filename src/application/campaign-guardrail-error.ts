export class CampaignGuardrailError extends Error {
  readonly violations: string[]

  constructor(violations: string[]) {
    super(`Campaign blocked: ${violations.join('; ')}`)
    this.name = 'CampaignGuardrailError'
    this.violations = violations
  }
}
