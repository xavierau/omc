import {
  getMetaBusinessAccountId,
  getRestaurantPhoneNumberId,
  updateMetaBusinessAccountId,
} from '@/infrastructure/supabase/repositories/restaurant-repository'
import { resolveWabaId } from '@/infrastructure/whatsapp/templates'

/**
 * The restaurant's WABA id for a template submission: the stored one, else
 * derived from its linked phone number and stored. null when neither works, so
 * the caller keeps the template as an unsubmitted draft.
 */
export async function ensureWabaId(restaurantId: string): Promise<string | null> {
  // `||`, not `??`: an unset WABA is stored as '' rather than NULL, and '' must
  // still fall through to auto-resolution or the draft is never submitted at all.
  return (await getMetaBusinessAccountId(restaurantId)) || autoResolveWabaId(restaurantId)
}

async function autoResolveWabaId(restaurantId: string): Promise<string | null> {
  const phoneNumberId = await getRestaurantPhoneNumberId(restaurantId)
  if (!phoneNumberId) return null

  const wabaId = await resolveWabaId(phoneNumberId)
  if (!wabaId) return null

  await updateMetaBusinessAccountId(restaurantId, wabaId)
  return wabaId
}
