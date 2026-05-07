import { sendInBatches, type SendContext } from './execute-campaign-batch'
import { findActiveMarketingConsentForPhones } from '@/infrastructure/supabase/repositories/consent-record-repository'
import { ReconfirmationTemplateError } from '@/domain/services/__errors__/reconfirmation-errors'
import type { Member } from '@/domain/entities/member'
import type { ConsentRecord } from '@/domain/entities/consent-record'

interface ExecuteInput {
  members: Member[]
  ctx: SendContext
  // Optional cap-at-batch-time clamp; when set, only the first N members
  // pass the recheck gate. Used by callers that have already computed
  // `cap - currentDailySent` and want to enforce it as a hard ceiling.
  dailyAllotment?: number
}

/**
 * WONB-008 reconfirmation batch orchestrator. Wraps `sendInBatches` with
 * two reconfirmation-specific gates:
 *   1. Template MUST be `category='UTILITY'` (legacy contacts have no
 *      strong marketing consent — Meta forbids MARKETING templates).
 *   2. Per-row defence-in-depth: re-check `grade='weak' AND status='opted_in'`
 *      at send time so concurrent upgrades / opt-outs that landed after the
 *      audience query don't get retargeted.
 * Skips are warned (not thrown) so the campaign continues with the
 * surviving subset.
 */
export async function executeReconfirmationBatch(
  input: ExecuteInput
): Promise<void> {
  assertUtilityTemplate(input.ctx)
  if (input.members.length === 0) return
  const capped = applyDailyAllotment(input.members, input.dailyAllotment)
  const eligible = await filterStillWeakOptedIn(capped, input.ctx)
  if (eligible.length === 0) return
  await sendInBatches(eligible, input.ctx)
}

function assertUtilityTemplate(ctx: SendContext): void {
  if (!ctx.template || ctx.template.category !== 'UTILITY') {
    throw new ReconfirmationTemplateError('not_utility')
  }
}

function applyDailyAllotment(
  members: Member[],
  cap: number | undefined
): Member[] {
  if (cap === undefined) return members
  if (cap <= 0) return []
  return members.slice(0, cap)
}

async function filterStillWeakOptedIn(
  members: Member[],
  ctx: SendContext
): Promise<Member[]> {
  const consents = await findActiveMarketingConsentForPhones({
    restaurantId: ctx.campaign.restaurantId,
    phones: members.map((m) => m.phone),
  })
  return members.filter((m) => isStillWeakOptedIn(m, consents))
}

function isStillWeakOptedIn(
  member: Member,
  consents: Map<string, ConsentRecord>
): boolean {
  const record = consents.get(member.phone)
  if (!record) {
    logSkip(member, 'consent_gone')
    return false
  }
  const { consentGrade, status } = record.snapshot
  if (consentGrade !== 'weak' || status !== 'opted_in') {
    logSkip(member, `grade=${consentGrade},status=${status}`)
    return false
  }
  return true
}

function logSkip(member: Member, reason: string): void {
  console.warn(
    '[reconfirmation] per-row recheck skip',
    { memberId: member.id, reason }
  )
}
