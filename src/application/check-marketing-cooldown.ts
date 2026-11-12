// WAQ-007: per-user marketing cooldown gate.
//
// Sibling to WAQ-004's `check-marketing-consent`. Where consent answers "is
// the recipient willing?", cooldown answers "would another marketing send
// breach Meta's per-business cap or our PMM regression guard?".
//
// Three reasons can deny: pmm_throttled (set by WAQ-003 on 131049),
// unreachable (set by WAQ-003 on 131026), and cap_exceeded (count gate
// against `tenant_campaign_settings.per_user_marketing_cap`). The
// per-recipient view supplies the throttle / unreachable timestamps so this
// helper is pure logic + ONE bulk count query for the batch path.

import {
  countMarketingSendsLast24h,
  countMarketingSendsLast24hForPhones,
} from '@/infrastructure/supabase/repositories/whatsapp-message-repository'
import type { SkipDecision } from '@/domain/value-objects/marketing-skip-reason'

interface CheckArgs {
  restaurantId: string
  phoneE164: string
  memberPmmThrottledUntil: string | null
  memberUnreachableAt: string | null
  cap: number
}

export async function checkMarketingCooldown(
  args: CheckArgs
): Promise<SkipDecision> {
  const flagDecision = decideFromFlags(args)
  if (flagDecision) return flagDecision
  const count = await countMarketingSendsLast24h({
    restaurantId: args.restaurantId,
    phoneE164: args.phoneE164,
  })
  return decideFromCount(count, args.cap)
}

interface BulkCheckArgs {
  restaurantId: string
  recipients: Array<{
    phoneE164: string
    memberPmmThrottledUntil: string | null
    memberUnreachableAt: string | null
  }>
  cap: number
}

/**
 * Bulk variant for the campaign batch path: ONE round-trip to count
 * marketing sends for the whole batch, decisions composed in memory. Mirrors
 * `bulkCheckMarketingConsent` so the batch path can compose both gates with
 * the same shape (Map<phoneE164, SkipDecision>).
 */
export async function bulkCheckMarketingCooldown(
  args: BulkCheckArgs
): Promise<Map<string, SkipDecision>> {
  if (args.recipients.length === 0) return new Map()
  const counts = await countMarketingSendsLast24hForPhones({
    restaurantId: args.restaurantId,
    phones: args.recipients.map((r) => r.phoneE164),
  })
  return decideForRecipients(args.recipients, counts, args.cap)
}

function decideForRecipients(
  recipients: BulkCheckArgs['recipients'],
  counts: Map<string, number>,
  cap: number
): Map<string, SkipDecision> {
  const out = new Map<string, SkipDecision>()
  for (const r of recipients) {
    const flag = decideFromFlags(r)
    out.set(r.phoneE164, flag ?? decideFromCount(counts.get(r.phoneE164) ?? 0, cap))
  }
  return out
}

function decideFromFlags(args: {
  memberPmmThrottledUntil: string | null
  memberUnreachableAt: string | null
}): SkipDecision | null {
  // Throttle is checked before unreachable so a member that hits BOTH
  // (extremely rare race) surfaces the more actionable reason first —
  // pmm_throttled has a known clear date; unreachable is sticky.
  if (isThrottled(args.memberPmmThrottledUntil)) {
    return { allowed: false, reason: 'pmm_throttled' }
  }
  // Loose `!=` so an `undefined` from a callsite that has not yet adopted
  // the new Member shape doesn't accidentally flag the recipient as
  // unreachable. Only an actual ISO string from the DB column blocks here.
  if (args.memberUnreachableAt != null) {
    return { allowed: false, reason: 'unreachable' }
  }
  return null
}

function decideFromCount(count: number, cap: number): SkipDecision {
  if (count >= cap) return { allowed: false, reason: 'cap_exceeded' }
  return { allowed: true }
}

function isThrottled(throttledUntil: string | null): boolean {
  if (throttledUntil === null) return false
  return new Date(throttledUntil).getTime() > Date.now()
}
