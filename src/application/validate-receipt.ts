import type { ParsedReceipt } from '@/domain/interfaces/parsed-receipt'
import { assessTamperRisk, isMerchantMatch } from '@/domain/services/receipt-validation'
import { isReceiptNumberUsed } from '@/infrastructure/supabase/repositories/receipt-repository'
import { getRestaurantName } from '@/infrastructure/supabase/repositories/restaurant-repository'

export interface ValidationResult {
  valid: boolean
  rejectionReason?: string
}

export async function validateReceipt(params: {
  parsed: ParsedReceipt
  restaurantId: string
}): Promise<ValidationResult> {
  const { parsed, restaurantId } = params

  const tamperCheck = checkTamper(parsed)
  if (tamperCheck) return tamperCheck

  const duplicateCheck = await checkDuplicate(parsed, restaurantId)
  if (duplicateCheck) return duplicateCheck

  const merchantCheck = await checkMerchant(parsed, restaurantId)
  if (merchantCheck) return merchantCheck

  return { valid: true }
}

function checkTamper(parsed: ParsedReceipt): ValidationResult | null {
  const tamper = assessTamperRisk(parsed)
  if (!tamper.isSuspicious) return null
  return {
    valid: false,
    rejectionReason: 'This receipt appears to have been modified. Please submit an original receipt photo.',
  }
}

async function checkDuplicate(
  parsed: ParsedReceipt,
  restaurantId: string
): Promise<ValidationResult | null> {
  if (!parsed.receiptNumber) return null
  const used = await isReceiptNumberUsed(restaurantId, parsed.receiptNumber)
  if (!used) return null
  return {
    valid: false,
    rejectionReason: 'This receipt has already been submitted. Each receipt can only be used once.',
  }
}

async function checkMerchant(
  parsed: ParsedReceipt,
  restaurantId: string
): Promise<ValidationResult | null> {
  const restaurantName = await getRestaurantName(restaurantId)
  if (isMerchantMatch(parsed.merchantName, [restaurantName])) return null
  return {
    valid: false,
    rejectionReason: "This receipt doesn't appear to be from our restaurant. Please submit a receipt from our establishment.",
  }
}
