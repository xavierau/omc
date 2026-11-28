// INT-001 T-C1 / OD-14: pure decision over the latest consent_records row for
// one (restaurant, phone, category) identity. `opted_out` is absorbing on
// EVERY branch (new-member and existing-member alike) -- this is the fix for
// the STOP-resurrection defect: the old code only guarded the
// existing-member path, and the new-member path could insert a fresh
// `opted_in` row straight over a STOP because `idx_consent_active_uniq` is
// partial on (opted_in, pending).
//
// This function only decides the ACTION. The caller
// (`applyPartnerAssertedConsent` in
// `src/infrastructure/supabase/repositories/consent-record-repository.ts`)
// is responsible for actually writing rows and for choosing the status of an
// `inserted` row (opted_in when the asserted level covers the category,
// pending otherwise) via `covers()`.

import type { ConsentStatus } from '../value-objects/consent-status'
import type { ConsentLevel } from '../value-objects/consent-level'
import { covers, type PartnerConsentCategory } from '../value-objects/consent-level'
import type { PartnerConsentAction } from '../value-objects/partner-consent-action'

/**
 * @param latestStatus the status of the most-recently-captured row for this
 *   (restaurant, phone, category) identity across ALL statuses (not just the
 *   active ones), or `null` when no row exists yet.
 */
export function decidePartnerConsentAction(
  latestStatus: ConsentStatus | null,
  level: ConsentLevel,
  category: PartnerConsentCategory
): PartnerConsentAction {
  if (latestStatus === 'opted_out') return 'blocked_opted_out'
  if (latestStatus === null) return 'inserted'
  if (latestStatus === 'pending') {
    return covers(level, category) ? 'upgraded' : 'noop'
  }
  // latestStatus === 'opted_in': never demoted, never re-inserted.
  return 'noop'
}

/** The status an `inserted` action's new row should carry. */
export function insertedRowStatus(
  level: ConsentLevel,
  category: PartnerConsentCategory
): Extract<ConsentStatus, 'opted_in' | 'pending'> {
  return covers(level, category) ? 'opted_in' : 'pending'
}
