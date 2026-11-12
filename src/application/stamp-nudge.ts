// "X to go" come-back nudge (plan §7 / subtask 12). MARKETING-class: fires once per
// card when a granted stamp brings the diner to stamps_required - 1 (the last stamp
// before the reward). Gated by the REAL checkMarketingCooldown signature; suppressed
// (never queued) when the cooldown denies. Window-aware: free-form inside an open 24h
// window, else SUPPRESSED (no approved marketing template is configured for this nudge
// in MVP — deviation noted in the impl note). Best-effort: the caller (applyStampUseCase)
// swallows any throw so a nudge failure never affects the committed stamp.
import {
  getMemberNudgeState,
  claimNudgeSlot,
  type MemberNudgeState,
} from '@/infrastructure/supabase/repositories/stamp-nudge-repository'
import { getSettingsForTenant } from '@/infrastructure/supabase/repositories/campaign-settings-repository'
import { checkMarketingCooldown } from '@/application/check-marketing-cooldown'
import { isWindowOpen } from '@/infrastructure/supabase/repositories/conversation-window-repository'
import { sendTextMessage } from '@/infrastructure/whatsapp/messaging'
import { Language } from '@/domain/value-objects/language'
import { stampToGoNudge } from '@/application/messages/redeem-reward-messages'
import { DEFAULT_PER_USER_MARKETING_CAP } from '@/domain/services/campaign-guardrails'

export interface StampNudgeParams {
  restaurantId: string
  memberId: string
  cardId: string
  phoneNumberId: string
  stampsCount: number
  stampsRequired: number
}

function isLastBeforeReward(p: StampNudgeParams): boolean {
  return p.stampsCount === p.stampsRequired - 1 && p.stampsCount > 0
}

export async function maybeSendStampNudge(p: StampNudgeParams): Promise<void> {
  if (!isLastBeforeReward(p)) return
  const member = await getMemberNudgeState(p.memberId, p.restaurantId)
  if (!member) return

  if (!(await passesGates(p, member))) return
  if (!(await claimNudgeSlot(p.cardId))) return

  await sendNudge(p, member)
}

async function passesGates(
  p: StampNudgeParams,
  member: MemberNudgeState
): Promise<boolean> {
  const decision = await checkMarketingCooldown({
    restaurantId: p.restaurantId,
    phoneE164: member.phone,
    memberPmmThrottledUntil: member.pmmThrottledUntil,
    memberUnreachableAt: member.unreachableAt,
    cap: await loadCap(p.restaurantId),
  })
  if (!decision.allowed) return false
  // Window-aware: free-form only inside an open 24h window; otherwise suppress
  // (no approved marketing-template path for this nudge in MVP).
  return isWindowOpen({ restaurantId: p.restaurantId, phoneE164: member.phone })
}

async function loadCap(restaurantId: string): Promise<number> {
  const settings = await getSettingsForTenant(restaurantId)
  return settings?.perUserMarketingCap ?? DEFAULT_PER_USER_MARKETING_CAP
}

async function sendNudge(
  p: StampNudgeParams,
  member: MemberNudgeState
): Promise<void> {
  const language = Language.fromCodeOrDefault(
    member.preferredLanguage,
    Language.default()
  )
  const body = stampToGoNudge(language, {
    stampsCount: p.stampsCount,
    stampsRequired: p.stampsRequired,
  })
  await sendTextMessage(p.phoneNumberId, member.phone, body)
}
