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

// #6 (WI-17 confirmation review, grok): `code: 'internal'` marks a CAUGHT,
// untyped exception (process-member-create-job.ts's generic catch) -- its
// `message` is whatever the underlying Postgres/driver/JS error said
// (phone-redacted by I-3, nothing else redacted). That raw text is for
// ops/the tenant owner ONLY: it stays exactly as persisted, still readable
// via `snapshot.error.message` (the owner's activity log, WI-8) and the
// Slack alert `process-member-create-job.ts` sends alongside it -- this
// constant is substituted ONLY in `partnerView()` below, never written back
// to the stored row. Every OTHER code this job ever finalises with
// (`tenant_inactive`, `integration_paused` -- `PermanentJobFailure`'s own
// `code`, which IS its `message`) is already a fixed, safe, non-internal
// string and passes through unchanged.
const GENERIC_INTERNAL_ERROR_MESSAGE = 'An internal error occurred while processing this request.'

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
    // #6: 'internal' is the one code whose message is an arbitrary caught
    // exception's text, never partner-safe -- see GENERIC_INTERNAL_ERROR_MESSAGE.
    const error: MemberJobError =
      p.error.code === 'internal' ? { code: p.error.code, message: GENERIC_INTERNAL_ERROR_MESSAGE } : p.error
    return { status: 'failed', error }
  }

  isExpired(now: Date): boolean {
    if (!this.props.resultExpiresAt) return false
    return now.getTime() > new Date(this.props.resultExpiresAt).getTime()
  }
}
