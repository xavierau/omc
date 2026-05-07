import type { ConsentRecord } from '../entities/consent-record'
import type {
  ConsentCategory,
  ConsentGrade,
  ConsentStatus,
} from '../value-objects/consent-status'

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
   * WONB-008: tally consent rows scoped to a (restaurant, grade, status,
   * category) tuple. Single COUNT query — used by the reconfirmation
   * pre-flight to size the audience (`grade='weak' AND status='opted_in'`).
   */
  countByGradeStatus(args: {
    restaurantId: string
    grade: ConsentGrade
    status: ConsentStatus
    category: ConsentCategory
  }): Promise<number>

  /**
   * WONB-008: idempotent grade upgrade for the reconfirmation YES handler.
   * Matches `consent_grade='weak' AND status='opted_in'`; sets
   * `consent_grade='strong', granted_at=now()`. Returns true only when a
   * weak+opted_in row was actually upgraded. False covers "already strong",
   * "weak+pending", "no row exists". Never throws on missing rows.
   */
  upgradeGradeToStrong(args: {
    restaurantId: string
    phoneE164: string
    category: ConsentCategory
  }): Promise<boolean>
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
