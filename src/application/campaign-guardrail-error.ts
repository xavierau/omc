// Budget for a guardrail error's full message: the campaign-queue worker
// truncates anything past this before persisting campaigns.failure_reason,
// so a message that must survive verbatim (WAQ-014) has to stay within it.
// Single definition — the queue's truncation and the length-guard test both
// import it so the cap and the guard cannot drift apart.
export const FAILURE_REASON_MAX_LEN = 500

export class CampaignGuardrailError extends Error {
  readonly violations: string[]

  constructor(violations: string[]) {
    super(`Campaign blocked: ${violations.join('; ')}`)
    this.name = 'CampaignGuardrailError'
    this.violations = violations
  }
}
