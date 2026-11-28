/**
 * Bilingual copy for the `awardPoints` use case — the "you earned X points"
 * notification sent after a receipt is successfully processed.
 */
import { Language } from '@/domain/value-objects/language'

export interface PointsEarnedVars {
  pointsEarned: number
  newBalance: number
}

export function pointsEarnedMessage(
  language: Language,
  vars: PointsEarnedVars
): string {
  if (language.equals(Language.EN)) {
    return (
      `You earned ${vars.pointsEarned} points!\n` +
      `Your new balance: ${vars.newBalance} points. Keep it up!`
    )
  }
  return (
    `您獲得 ${vars.pointsEarned} 積分！\n` +
    `目前餘額：${vars.newBalance} 積分。繼續努力！`
  )
}
