/**
 * Bilingual copy for the `redeemRewardUseCase` outcomes. Pure string builders.
 */
import { Language } from '@/domain/value-objects/language'

export function rewardNotFoundMessage(language: Language): string {
  return language.equals(Language.EN) ? 'Reward not found.' : '找不到此獎賞。'
}

export function rewardInsufficientPointsMessage(
  language: Language,
  vars: { balance: number; cost: number }
): string {
  if (language.equals(Language.EN)) {
    return `Not enough points. You have ${vars.balance} points but need ${vars.cost}.`
  }
  return `積分不足。您目前有 ${vars.balance} 積分，需要 ${vars.cost} 積分。`
}

export interface RewardCelebrationVars {
  name: string
  pointsCost: number
  discountType: string
  discountValue: number
  code: string
  newBalance: number
}

export function rewardRedeemedCelebration(
  language: Language,
  vars: RewardCelebrationVars
): string {
  const discount = formatDiscount(vars.discountType, vars.discountValue)
  if (language.equals(Language.EN)) {
    return [
      `\u{1F389} You redeemed ${vars.name} (${discount} off) for ${vars.pointsCost} points!`,
      `Your code: *${vars.code}*`,
      `New balance: ${vars.newBalance} points`,
    ].join('\n')
  }
  return [
    `\u{1F389} 您已兌換 ${vars.name}（${discount}）—花費 ${vars.pointsCost} 積分！`,
    `您的代碼：*${vars.code}*`,
    `餘額：${vars.newBalance} 積分`,
  ].join('\n')
}

export interface StampCelebrationVars {
  name: string
  discountType: string
  discountValue: number
  code: string
}

/**
 * Stamp-completion celebration — the no-points variant. A completed stamp card
 * has NO points cost and NO balance, so this template omits both fields (the
 * points celebration's `pointsCost`/`newBalance` would be meaningless here).
 */
export function stampRewardUnlockedCelebration(
  language: Language,
  vars: StampCelebrationVars
): string {
  const discount = formatDiscount(vars.discountType, vars.discountValue)
  if (language.equals(Language.EN)) {
    return [
      `\u{1F389} Stamp card complete! You unlocked ${vars.name} (${discount} off).`,
      `Your code: *${vars.code}*`,
    ].join('\n')
  }
  return [
    `\u{1F389} 印花卡儲滿！您已解鎖 ${vars.name}（${discount}）。`,
    `您的代碼：*${vars.code}*`,
  ].join('\n')
}

export function rewardQrCaption(
  language: Language,
  vars: { code: string }
): string {
  return language.equals(Language.EN)
    ? `Your code: ${vars.code}`
    : `您的代碼：${vars.code}`
}

/**
 * "X to go" come-back nudge (plan §7) — sent once per card when the diner is one
 * stamp short of the reward. MARKETING-class copy.
 */
export function stampToGoNudge(
  language: Language,
  vars: { stampsCount: number; stampsRequired: number }
): string {
  const remaining = vars.stampsRequired - vars.stampsCount
  if (language.equals(Language.EN)) {
    return `✨ Almost there! ${vars.stampsCount}/${vars.stampsRequired} stamps — just ${remaining} to go for your reward. See you soon!`
  }
  return `✨ 就快儲滿！${vars.stampsCount}/${vars.stampsRequired} 個印花，仲差 ${remaining} 個就有獎賞。期待您再次光臨！`
}

function formatDiscount(type: string, value: number): string {
  const prefix = type === 'fixed_amount' ? 'HK$' : ''
  const suffix = type === 'percentage' ? '%' : ''
  return `${prefix}${value}${suffix}`
}
