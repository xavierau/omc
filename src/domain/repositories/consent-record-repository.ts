import type { ConsentRecord } from '../entities/consent-record'
import type { ConsentCategory, ConsentGrade } from '../value-objects/consent-status'
import type { ConsentLevel, PartnerConsentCategory } from '../value-objects/consent-level'
import type { PartnerConsentAction } from '../value-objects/partner-consent-action'

/**
 * Contract for the `consent_records` writer/reader. The Supabase
 * implementation lives in `src/infrastructure/supabase/repositories/`
 * and is the SOLE writer to the table (service role bypasses RLS).
 */
export interface ConsentRecordRepository {
  /**
   * Returns the most recently captured active consent (status='opted_in' or
   * 'pending') for the given recipient + category, or null when none exists.
   * Used by the marketing pre-send gate.
   */
  findActive(args: {
    restaurantId: string
    phoneE164: string
    category: ConsentCategory
  }): Promise<ConsentRecord | null>

  /**
   * Bulk variant of `findActive` scoped to category='marketing'. Resolves to
   * a Map<phoneE164, ConsentRecord> in a SINGLE round-trip. Empty `phones`
   * returns an empty map without hitting the database. Used by the campaign
   * batch send to eliminate N+1 consent lookups.
   */
  findActiveMarketingForPhones(args: {
    restaurantId: string
    phones: string[]
  }): Promise<Map<string, ConsentRecord>>

  /**
   * Insert a new consent record. Throws ConsentImportError with reason
   * 'duplicate_active' on partial-unique-index violation. Other database
   * errors throw a generic Error.
   */
  insert(record: ConsentRecord): Promise<void>

  /**
   * Bulk-revoke all active consents for the recipient (optionally narrowed
   * to a category). Returns the count of rows revoked.
   */
  revoke(args: {
    restaurantId: string
    phoneE164: string
    category?: ConsentCategory
  }): Promise<number>

  /**
   * WONB-005: idempotent pending → opted_in transition for the inbound-YES
   * webhook (WONB-007) and the re-confirmation campaign (WONB-008). Returns
   * true only when a pending row was actually upgraded; false covers both
   * "already opted_in" and "no row exists". Never throws on missing rows.
   */
  upgradeToOptedIn(args: {
    restaurantId: string
    phoneE164: string
    category: ConsentCategory
  }): Promise<boolean>

  /**
   * INT-001 T-C1: the most-recently-captured row for this identity across
   * ALL statuses (including opted_out), or null when none exists. Unlike
   * `findActive`, this is the lookup that must see a STOP so the caller can
   * treat it as absorbing rather than accidentally re-consenting over it.
   */
  findLatestByCategory(args: {
    restaurantId: string
    phoneE164: string
    category: ConsentCategory
  }): Promise<ConsentRecord | null>

  /**
   * INT-001 T-C1 / OD-13 / OD-14: the SOLE way the partner API path may
   * write consent. `opted_out` is absorbing (writes nothing, returns
   * 'blocked_opted_out') on every branch -- new-member and existing-member
   * alike. `grade`/`consentText` come from the caller's OD-13 determination
   * (per-integration consent_attestation_text present+acked -> 'strong' with
   * the attestation copied in; absent -> 'weak').
   */
  applyPartnerAssertedConsent(args: {
    restaurantId: string
    phoneE164: string
    memberId: string | null
    category: PartnerConsentCategory
    assertedLevel: ConsentLevel
    integrationId: string
    grade: ConsentGrade
    consentText: string | null
    businessNameShown: string | null
  }): Promise<PartnerConsentAction>
}

export type ConsentImportReason =
  | 'duplicate_active'
  | 'missing_consent_source'
  | 'member_insert_failed'
  | 'consent_insert_failed'

export class ConsentImportError extends Error {
  constructor(public readonly reason: ConsentImportReason, message?: string) {
    super(message ?? reason)
    this.name = 'ConsentImportError'
  }
}
