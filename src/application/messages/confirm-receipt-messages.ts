/**
 * Bilingual copy for receipt processing: confirmation prompt + rejection
 * reasons. Receipt validation rejection text is UX-critical (member must
 * retake photo or pick a different receipt), so it is localized. The
 * catch-all processing-error text stays English per scope lock.
 */
import { Language } from '@/domain/value-objects/language'

export function confirmTotalPrompt(
  language: Language,
  vars: { total: number }
): string {
  const formatted = vars.total.toFixed(0)
  if (language.equals(Language.EN)) {
    return (
      `I read your total as $${formatted}. Is that right?\n` +
      `Reply YES to confirm, or type the correct amount.`
    )
  }
  return (
    `讀取到的金額為 $${formatted}，是否正確？\n` +
    `回覆 YES 確認，或輸入正確金額。`
  )
}

export function receiptUnreadableMessage(language: Language): string {
  return language.equals(Language.EN)
    ? "Sorry, I couldn't read that receipt. Could you take a clearer photo?"
    : '抱歉，無法讀取此收據，請傳送較清晰的相片。'
}

export function receiptDuplicateMessage(language: Language): string {
  return language.equals(Language.EN)
    ? 'This receipt has already been submitted. Each receipt can only be used once.'
    : '此收據已提交過，每張收據只可使用一次。'
}

export function receiptWrongMerchantMessage(language: Language): string {
  return language.equals(Language.EN)
    ? "This receipt doesn't appear to be from our restaurant. Please submit a receipt from our establishment."
    : '此收據並非本店收據，請提交本店發出的收據。'
}

export function receiptTamperedMessage(language: Language): string {
  return language.equals(Language.EN)
    ? 'This receipt appears to have been modified. Please submit an original receipt photo.'
    : '此收據疑似經過修改，請提供原件相片。'
}

/**
 * Sent after the member replies NO to the total-confirmation prompt, clearing
 * the pending receipt and inviting a fresh submission.
 */
export function receiptCancelledMessage(language: Language): string {
  return language.equals(Language.EN)
    ? 'Receipt cancelled. Send a new photo anytime.'
    : '已取消收據。您可隨時傳送新相片。'
}

/**
 * Catch-all error — stays English per ONBOARD-008 scope lock. Takes
 * `Language` only so callers forward it uniformly; the English-only body is
 * intentional.
 */
export function receiptProcessingErrorMessage(
  language: Language
): string {
  void language
  return 'Sorry, there was an error processing your receipt. Please try again.'
}

export type RejectionReason = 'tamper' | 'duplicate' | 'wrong_merchant'

/** Maps a structured rejection code to the localized rejection text. */
export function rejectionMessage(
  reason: RejectionReason,
  language: Language
): string {
  if (reason === 'tamper') return receiptTamperedMessage(language)
  if (reason === 'duplicate') return receiptDuplicateMessage(language)
  return receiptWrongMerchantMessage(language)
}
