import { findMemberByPhone } from '@/infrastructure/supabase/repositories/member-repository'
import { sendTextMessage } from '@/infrastructure/whatsapp/messaging'
import { getRestaurantPhoneNumberId } from '@/infrastructure/supabase/repositories/restaurant-repository'
import { PhoneNumber } from '@/domain/value-objects/phone-number'
import type { PosWebhookEvent } from '@/domain/ports/pos-webhook'
import type { PosIntegration } from '@/domain/entities/pos-integration'

export async function findPosTransactionMember(
  event: PosWebhookEvent,
  integration: PosIntegration
): Promise<{ id: string; pointsBalance: number } | null> {
  if (!event.customerPhone) return null
  const phone = PhoneNumber.create(event.customerPhone).value
  return findMemberByPhone(integration.restaurantId, phone)
}

export async function notifyPosTransaction(
  restaurantId: string,
  phone: string,
  message: string
): Promise<void> {
  try {
    const phoneNumberId = await getRestaurantPhoneNumberId(restaurantId)
    const normalizedPhone = PhoneNumber.create(phone).value
    await sendTextMessage(phoneNumberId, normalizedPhone, message)
  } catch (err) {
    console.warn('[PosNotification] Failed to send notification:', (err as Error).message)
  }
}
