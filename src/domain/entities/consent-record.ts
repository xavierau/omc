import type {
  ConsentCategory,
  ConsentGrade,
  ConsentStatus,
} from '../value-objects/consent-status'

export interface ConsentRecordProps {
  id: string
  restaurantId: string
  memberId: string | null
  phoneE164: string
  category: ConsentCategory
  status: ConsentStatus
  consentGrade: ConsentGrade
  source: string
  sourceReference: string | null
  businessNameShown: string | null
  capturedAt: string
  revokedAt: string | null
  capturedIp: string | null
  capturedUserAgent: string | null
  // WONB-005 audit + expiry
  proofUrl: string | null
  consentTextShown: string | null
  expiresAt: string | null
  // Explicit moment the row was promoted to opted_in. NULL while pending /
  // for legacy rows that pre-date this column. The repo stamps it on flip;
  // entity defaults to null.
  grantedAt: string | null
  // WONB-004 audit linkage. Set when the consent row originates from the
  // bulk import wizard so admins can trace each row back to its batch row.
  importBatchId: string | null
}

export interface GrantConsentInput {
  id: string
  restaurantId: string
  memberId: string | null
  phoneE164: string
  category: ConsentCategory
  source: string
  sourceReference?: string | null
  businessNameShown?: string | null
  grade?: ConsentGrade
  capturedAt?: Date
  capturedIp?: string | null
  capturedUserAgent?: string | null
  proofUrl?: string | null
  consentTextShown?: string | null
  expiresAt?: string | null
  importBatchId?: string | null
}

export interface MarkPendingInput {
  id: string
  restaurantId: string
  memberId: string | null
  phoneE164: string
  category: ConsentCategory
  source: string
  sourceReference?: string | null
  businessNameShown?: string | null
  proofUrl?: string | null
  consentTextShown?: string | null
  expiresAt?: string | null
  importBatchId?: string | null
}

export class ConsentRecord {
  private constructor(private readonly props: ConsentRecordProps) {}

  static grant(input: GrantConsentInput): ConsentRecord {
    assertNonEmpty('source', input.source)
    assertNonEmpty('phoneE164', input.phoneE164)
    return new ConsentRecord({
      id: input.id,
      restaurantId: input.restaurantId,
      memberId: input.memberId,
      phoneE164: input.phoneE164,
      category: input.category,
      status: 'opted_in',
      consentGrade: input.grade ?? 'strong',
      source: input.source,
      sourceReference: input.sourceReference ?? null,
      businessNameShown: input.businessNameShown ?? null,
      capturedAt: (input.capturedAt ?? new Date()).toISOString(),
      revokedAt: null,
      capturedIp: input.capturedIp ?? null,
      capturedUserAgent: input.capturedUserAgent ?? null,
      proofUrl: input.proofUrl ?? null,
      consentTextShown: input.consentTextShown ?? null,
      expiresAt: input.expiresAt ?? null,
      grantedAt: null,
      importBatchId: input.importBatchId ?? null,
    })
  }

  static markPending(input: MarkPendingInput): ConsentRecord {
    assertNonEmpty('source', input.source)
    assertNonEmpty('phoneE164', input.phoneE164)
    return new ConsentRecord({
      id: input.id,
      restaurantId: input.restaurantId,
      memberId: input.memberId,
      phoneE164: input.phoneE164,
      category: input.category,
      status: 'pending',
      consentGrade: 'strong',
      source: input.source,
      sourceReference: input.sourceReference ?? null,
      businessNameShown: input.businessNameShown ?? null,
      capturedAt: new Date().toISOString(),
      revokedAt: null,
      capturedIp: null,
      capturedUserAgent: null,
      proofUrl: input.proofUrl ?? null,
      consentTextShown: input.consentTextShown ?? null,
      expiresAt: input.expiresAt ?? null,
      grantedAt: null,
      importBatchId: input.importBatchId ?? null,
    })
  }

  static fromProps(props: ConsentRecordProps): ConsentRecord {
    return new ConsentRecord(props)
  }

  /** Idempotent transition to opted_out. Preserves audit fields. */
  revoke(at: Date): ConsentRecord {
    if (this.props.status === 'opted_out') return this
    return new ConsentRecord({
      ...this.props,
      status: 'opted_out',
      revokedAt: at.toISOString(),
    })
  }

  get snapshot(): Readonly<ConsentRecordProps> {
    return this.props
  }
}

function assertNonEmpty(field: string, value: string): void {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`ConsentRecord: ${field} is required`)
  }
}
