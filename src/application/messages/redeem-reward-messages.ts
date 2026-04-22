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

export function rewardQrCaption(
  language: Language,
  vars: { code: string }
): string {
  return language.equals(Language.EN)
    ? `Your code: ${vars.code}`
    : `您的代碼：${vars.code}`
}

function formatDiscount(type: string, value: number): string {
  const prefix = type === 'fixed_amount' ? 'HK$' : ''
  const suffix = type === 'percentage' ? '%' : ''
  return `${prefix}${value}${suffix}`
}
