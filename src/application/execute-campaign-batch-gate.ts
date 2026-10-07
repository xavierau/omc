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
 * Consent reasons (opted_out / no_consent / pending) take precedence over
 * cooldown reasons. Compliance is a legal boundary (HK PDPO) — surfacing
 * 'cap_exceeded' for an opted_out recipient would mask the consent
 * violation in downstream skip-reason analytics + WONB-008 re-confirmation
 * stats. Once consent passes, cooldown reasons surface the quality-state
 * regression.
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
    const cons = consent.get(phone)
    if (cons && !cons.allowed) {
      out.set(phone, cons)
      continue
    }
    const cool = cooldown.get(phone)
    if (cool && !cool.allowed) {
      out.set(phone, cool)
      continue
    }
    out.set(phone, { allowed: true })
  }
  return out
}
