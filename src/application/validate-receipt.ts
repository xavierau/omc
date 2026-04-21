import type { ParsedReceipt } from '@/domain/interfaces/parsed-receipt'
import { assessTamperRisk, isMerchantMatch } from '@/domain/services/receipt-validation'
import { isReceiptNumberUsed } from '@/infrastructure/supabase/repositories/receipt-repository'
import { getRestaurantName } from '@/infrastructure/supabase/repositories/restaurant-repository'
import type { RejectionReason } from './messages/confirm-receipt-messages'

export type { RejectionReason }

export interface ValidationResult {
  valid: boolean
  /**
   * Structured rejection code so the caller can localize. The adapter maps
   * each code to bilingual copy via `confirm-receipt-messages.ts`.
   */
  reason?: RejectionReason
}

export async function validateReceipt(params: {
  parsed: ParsedReceipt
  restaurantId: string
}): Promise<ValidationResult> {
  const { parsed, restaurantId } = params

  if (checkTamper(parsed)) return { valid: false, reason: 'tamper' }

  if (await checkDuplicate(parsed, restaurantId)) {
    return { valid: false, reason: 'duplicate' }
  }

  if (await checkWrongMerchant(parsed, restaurantId)) {
    return { valid: false, reason: 'wrong_merchant' }
  }

  return { valid: true }
}

function checkTamper(parsed: ParsedReceipt): boolean {
  return assessTamperRisk(parsed).isSuspicious
}

async function checkDuplicate(
  parsed: ParsedReceipt,
  restaurantId: string
): Promise<boolean> {
  if (!parsed.receiptNumber) return false
  return isReceiptNumberUsed(restaurantId, parsed.receiptNumber)
}

async function checkWrongMerchant(
  parsed: ParsedReceipt,
  restaurantId: string
): Promise<boolean> {
  const restaurantName = await getRestaurantName(restaurantId)
  return !isMerchantMatch(parsed.merchantName, [restaurantName])
}
