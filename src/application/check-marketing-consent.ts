import {
  findActiveConsent,
  findActiveMarketingConsentForPhones,
} from '@/infrastructure/supabase/repositories/consent-record-repository'
import type { ConsentRecord } from '@/domain/entities/consent-record'
import type { ConsentGrade } from '@/domain/value-objects/consent-status'
import type { MarketingSkipReason } from '@/domain/value-objects/marketing-skip-reason'

// Subset of MarketingSkipReason that the consent gate alone can produce. The
// cooldown gate emits the rest (pmm_throttled / cap_exceeded / unreachable).
// Aliased to the unified union so callers that combine gates can handle a
// single SkipDecision type — see WAQ-007.
export type ConsentRejectionReason = Extract<
  MarketingSkipReason,
  'no_consent' | 'opted_out' | 'pending'
>

export interface ConsentCheckResult {
  allowed: boolean
  reason?: ConsentRejectionReason
  grade?: ConsentGrade
}

interface CheckArgs {
  restaurantId: string
  phoneE164: string
}

/**
 * Pre-send marketing-consent gate. Returns `{ allowed: true, grade }` only
 * when an opted_in record exists for (restaurantId, phoneE164, marketing).
 * Pending and (defensively) opted_out are denied so a stray pending row
 * cannot leak into a marketing send.
 */
export async function checkMarketingConsent(
  args: CheckArgs
): Promise<ConsentCheckResult> {
  const record = await findActiveConsent({
    restaurantId: args.restaurantId,
    phoneE164: args.phoneE164,
    category: 'marketing',
  })
  return decideFromRecord(record ?? null)
}

interface BulkCheckArgs {
  restaurantId: string
  phones: string[]
}

/**
 * Bulk variant for the campaign batch path: ONE repository round-trip for
 * the whole batch instead of N individual `checkMarketingConsent` calls.
 * Returns a Map<phoneE164, ConsentCheckResult> with an entry for every
 * requested phone (missing rows decide as `no_consent`) so callers can
 * iterate without null-checks.
 */
export async function bulkCheckMarketingConsent(
  args: BulkCheckArgs
): Promise<Map<string, ConsentCheckResult>> {
  const out = new Map<string, ConsentCheckResult>()
  if (args.phones.length === 0) return out
  const recordByPhone = await findActiveMarketingConsentForPhones({
    restaurantId: args.restaurantId,
    phones: args.phones,
  })
  for (const phone of args.phones) {
    out.set(phone, decideFromRecord(recordByPhone.get(phone) ?? null))
  }
  return out
}

function decideFromRecord(record: ConsentRecord | null): ConsentCheckResult {
  if (!record) return { allowed: false, reason: 'no_consent' }
  const { status, consentGrade } = record.snapshot
  if (status === 'opted_in') return { allowed: true, grade: consentGrade }
  if (status === 'pending') return { allowed: false, reason: 'pending' }
  return { allowed: false, reason: 'opted_out' }
}
