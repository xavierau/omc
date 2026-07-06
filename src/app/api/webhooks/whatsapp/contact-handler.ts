import { sendCtaUrlButton } from '@/infrastructure/whatsapp/messaging'
import { findMemberByPhone } from '@/infrastructure/supabase/repositories/member-repository'
import { getRestaurantRedirect } from '@/infrastructure/supabase/repositories/restaurant-repository'
import { Language } from '@/domain/value-objects/language'
import { buildContactUrl } from '@/domain/services/contact-redirect'
import { resolveLanguageForMember } from './resolve-language'
import { handleHelp } from './unknown-help-handlers'

const CONTACT_BODY_EN = 'Tap below to chat with us directly.'
const CONTACT_BODY_ZH = '點擊下方按鈕即可直接與我們聯絡。'

/**
 * Handle a CONTACT command (typed keyword or tapped Contact row).
 *
 * Sends a WhatsApp CTA-URL button opening `https://wa.me/<redirect_number>`.
 * Membership-agnostic (Q3 RESOLVED): the CTA is sent whenever a valid redirect
 * exists, regardless of whether the caller is a member — the member lookup only
 * localizes the body copy. Falls back to `handleHelp` when no usable redirect
 * is configured (unset or an invalid stored number).
 */
export async function handleContact(
  phoneNumberId: string,
  phone: string,
  restaurantId: string
) {
  const { redirectNumber, redirectLabel } = await getRestaurantRedirect(restaurantId)
  const url = redirectNumber ? buildContactUrl(redirectNumber) : null
  if (!url) {
    return handleHelp(phoneNumberId, phone, restaurantId)
  }

  const member = await findMemberByPhone(restaurantId, phone)
  const language = await resolveLanguageForMember(member, restaurantId)
  const body = language.equals(Language.EN) ? CONTACT_BODY_EN : CONTACT_BODY_ZH
  return sendCtaUrlButton(phoneNumberId, phone, body, redirectLabel, url)
}
