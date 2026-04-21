import { sendTextMessage } from '@/infrastructure/whatsapp/messaging'
import { findMemberByPhone } from '@/infrastructure/supabase/repositories/member-repository'
import { findPendingReceipt, updateReceipt } from '@/infrastructure/supabase/repositories/receipt-repository'
import { confirmReceipt } from '@/application/process-receipt'
import { receiptCancelledMessage } from '@/application/messages/confirm-receipt-messages'
import { resolveLanguageForMember } from './resolve-language'

export interface ConfirmationParams {
  phoneNumberId: string
  phone: string
  /** 'YES' confirms, 'NO' rejects+clears, null enables numeric-amount fallback. */
  route: 'YES' | 'NO' | null
  restaurantId: string
  text?: string
}

/**
 * Handle YES / NO / numeric-amount during pending receipt flow.
 *
 * Returns true if the message was consumed (caller should stop dispatching).
 * Returns false when the user has no pending receipt or the fallback numeric
 * branch does not apply — caller falls through to `handleUnknown`.
 */
export async function handleReceiptConfirmation(
  params: ConfirmationParams
): Promise<boolean> {
  const { phoneNumberId, phone, route, restaurantId, text } = params
  const numericAmount = text !== undefined ? parseFloat(text) : NaN
  const isNumber = !isNaN(numericAmount) && numericAmount > 0

  if (route === null && !isNumber) return false

  const member = await findMemberByPhone(restaurantId, phone)
  if (!member) return false

  const pending = await findPendingReceipt(member.id)
  if (!pending) return false

  if (route === 'NO') {
    await rejectPending(pending.id as string, phoneNumberId, phone, member, restaurantId)
    return true
  }

  const amount = route === 'YES' ? (pending.pending_amount as number) : numericAmount
  await confirmReceipt(member.id, restaurantId, phone, pending.id as string, amount)
  return true
}

async function rejectPending(
  receiptId: string,
  phoneNumberId: string,
  phone: string,
  member: { preferredLanguage: string | null },
  restaurantId: string
): Promise<void> {
  await updateReceipt(receiptId, { status: 'rejected' })
  const lang = await resolveLanguageForMember(member, restaurantId)
  await sendTextMessage(phoneNumberId, phone, receiptCancelledMessage(lang))
}
