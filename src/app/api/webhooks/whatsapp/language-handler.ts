import { sendTextMessage } from '@/infrastructure/whatsapp/messaging'
import {
  findMemberByPhone,
  setMemberPreferredLanguageIfUnset,
  updateMemberPreferredLanguage,
} from '@/infrastructure/supabase/repositories/member-repository'
import { getRestaurantPhoneNumberId } from '@/infrastructure/supabase/repositories/restaurant-repository'
import { PhoneNumber } from '@/domain/value-objects/phone-number'
import { Language } from '@/domain/value-objects/language'
import { parseLanguageCommand } from '@/domain/services/parse-language-command'
import { detectLanguageFromText } from '@/domain/services/detect-language'
import type { KapsoMessage } from '@/infrastructure/whatsapp/webhooks'

interface PreloadedMember {
  id: string
  preferredLanguage: string | null
}

const CONFIRM_EN =
  "Language set to English. You'll receive messages in English from now on."
const CONFIRM_ZH =
  '語言已設定為繁體中文。日後會以繁體中文傳送訊息。'
const JOIN_HINT_EN = 'Reply JOIN to sign up first.'
const JOIN_HINT_ZH = '請回覆 JOIN 註冊。'

/**
 * Handle an explicit `LANG EN` / `LANG ZH` / `語言 英文` / `語言 中文`
 * command. Returns true when the message matched (caller short-circuits).
 *
 *   - Existing member: persist the new preference + send confirmation in the
 *     requested language.
 *   - Non-member: reply in the requested language asking them to JOIN first.
 *     Never persist — there is no member row to attach the preference to.
 */
export async function maybeHandleLanguageCommand(
  message: KapsoMessage,
  restaurantId: string
): Promise<boolean> {
  if (message.type !== 'text') return false
  const target = parseLanguageCommand(message.text)
  if (!target) return false

  const phone = PhoneNumber.create(message.from).value
  const phoneNumberId = await getRestaurantPhoneNumberId(restaurantId)
  const member = await findMemberByPhone(restaurantId, phone)

  if (!member) {
    await sendTextMessage(phoneNumberId, phone, joinHint(target))
    return true
  }

  await updateMemberPreferredLanguage(member.id, restaurantId, target.code)
  await sendTextMessage(phoneNumberId, phone, confirmationText(target))
  return true
}

/**
 * Silent script-based detection. Runs ONLY when the caller has already
 * verified the message is not a language command and not a JOIN keyword.
 *
 * Caller supplies the pre-loaded member (already fetched during routing) so
 * this path does ZERO extra DB reads in the common case. Persistence uses
 * `setMemberPreferredLanguageIfUnset` (guarded UPDATE) to prevent TOCTOU
 * races across concurrent inbounds.
 *
 * Never sends a message. Caller wraps this so a failure can't break the
 * primary routing flow.
 */
export async function maybeDetectLanguageForExistingMember(
  member: PreloadedMember | null,
  restaurantId: string,
  text: string | null | undefined
): Promise<void> {
  if (member === null) return
  if (member.preferredLanguage !== null) return
  const detected = detectLanguageFromText(text)
  if (!detected) return
  await setMemberPreferredLanguageIfUnset(member.id, restaurantId, detected.code)
}

function confirmationText(target: Language): string {
  return target.equals(Language.EN) ? CONFIRM_EN : CONFIRM_ZH
}

function joinHint(target: Language): string {
  return target.equals(Language.EN) ? JOIN_HINT_EN : JOIN_HINT_ZH
}
