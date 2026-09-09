// INT-001 OD-11: the async job record behind POST .../members and
// GET .../members/jobs/{jobId}. `partnerView()` is the ONLY way this entity
// may be serialised back to a partner -- it returns exactly the OD-11 field
// list (status/submitted_at/attempts while in flight; member_id + outcome on
// success; a structured error on failure) and NOTHING else: no coupon code,
// no consent level/status, no welcome outcome anywhere the partner can read
// it. The full record (consent actions, welcome outcome/detail, asserted
// level) is for the OWNER's activity log only (WI-8).

export type MemberJobStatus = 'queued' | 'processing' | 'succeeded' | 'failed'
export type MemberJobOutcome = 'created' | 'existing'
export type AssertedConsentLevel = 'none' | 'utility' | 'all'

export interface MemberJobError {
  code: string
  message: string
}

export interface MemberJobProps {
  jobId: string
  integrationId: string
  restaurantId: string
  status: MemberJobStatus
  outcome: MemberJobOutcome | null
  memberId: string | null
  error: MemberJobError | null
  assertedLevel: AssertedConsentLevel
  consentActions: Record<string, unknown> | null
  welcomeOutcome: string | null
  welcomeDetail: Record<string, unknown> | null
  attempts: number
  submittedAt: string
  startedAt: string | null
  completedAt: string | null
  resultExpiresAt: string | null
}

export type MemberJobPartnerView =
  | { status: 'queued' | 'processing'; submitted_at: string; attempts: number }
  | { status: 'succeeded'; member_id: string; outcome: MemberJobOutcome }
  | { status: 'failed'; error: MemberJobError }

export class MemberJob {
  private constructor(private readonly props: MemberJobProps) {}

  static fromProps(props: MemberJobProps): MemberJob {
    return new MemberJob(props)
  }

  get snapshot(): Readonly<MemberJobProps> {
    return this.props
  }

  /** OD-11: the ONLY shape a partner may ever see. */
  partnerView(): MemberJobPartnerView {
    const p = this.props
    if (p.status === 'queued' || p.status === 'processing') {
      return { status: p.status, submitted_at: p.submittedAt, attempts: p.attempts }
    }
    if (p.status === 'succeeded') {
      if (!p.memberId || !p.outcome) {
        throw new Error('MemberJob: succeeded status requires memberId and outcome')
      }
      return { status: 'succeeded', member_id: p.memberId, outcome: p.outcome }
    }
    // failed
    if (!p.error) {
      throw new Error('MemberJob: failed status requires an error')
    }
    return { status: 'failed', error: p.error }
  }

  isExpired(now: Date): boolean {
    if (!this.props.resultExpiresAt) return false
    return now.getTime() > new Date(this.props.resultExpiresAt).getTime()
  }
}
