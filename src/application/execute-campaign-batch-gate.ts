// Pre-send gate composition for the campaign batch path. Splits out of
// `execute-campaign-batch.ts` so the orchestrator stays under the file-size
// limit and so gate decisions can be unit-tested without going through the
// whole batch loop.

import { bulkCheckMarketingConsent } from './check-marketing-consent'
import { bulkCheckMarketingCooldown } from './check-marketing-cooldown'
import type { SkipDecision } from '@/domain/value-objects/marketing-skip-reason'
import type { Member } from '@/domain/entities/member'

interface GateInput {
  restaurantId: string
  cap: number
  batch: Member[]
}

/**
 * Compose the WAQ-004 consent gate and WAQ-007 cooldown gate into a single
 * per-phone decision. Each gate makes ONE bulk fetch — no per-member N+1.
 *
 * Cooldown signals (pmm_throttled / unreachable / cap_exceeded) take
 * precedence over consent reasons because they describe a quality-state
 * regression — surfacing 'no_consent' when a recipient is also throttled
 * would mask the more actionable signal in downstream skip-reason analytics.
 */
export async function loadMarketingGateDecisions(
  input: GateInput
): Promise<Map<string, SkipDecision>> {
  const phones = input.batch.map((m) => m.phone)
  const [consentMap, cooldownMap] = await Promise.all([
    bulkCheckMarketingConsent({
      restaurantId: input.restaurantId,
      phones,
    }),
    bulkCheckMarketingCooldown({
      restaurantId: input.restaurantId,
      cap: input.cap,
      recipients: input.batch.map((m) => ({
        phoneE164: m.phone,
        memberPmmThrottledUntil: m.pmmThrottledUntil,
        memberUnreachableAt: m.unreachableAt,
      })),
    }),
  ])
  return mergeDecisions(phones, consentMap, cooldownMap)
}

function mergeDecisions(
  phones: string[],
  consent: Map<string, SkipDecision>,
  cooldown: Map<string, SkipDecision>
): Map<string, SkipDecision> {
  const out = new Map<string, SkipDecision>()
  for (const phone of phones) {
    const cool = cooldown.get(phone)
    if (cool && !cool.allowed) {
      out.set(phone, cool)
      continue
    }
    const cons = consent.get(phone)
    if (cons && !cons.allowed) {
      out.set(phone, cons)
      continue
    }
    out.set(phone, { allowed: true })
  }
  return out
}
