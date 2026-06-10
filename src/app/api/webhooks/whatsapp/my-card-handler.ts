// 「我的會員碼」 retrieval handler (plan §8). Re-sends the member's persistent
// LOYALTY:<token> QR so a diner can show it to collect stamps.
//
// Opt-in gate = the CONSENT RECORD, not members.status (status ∈ active/unsubscribed
// only; opt-in lives in consent_records). A member who is not opted_in (pending or
// absent) is routed into the existing inbound-first opt-in flow (wonb-007) BEFORE the
// card is sent. The inbound already bumped the 24h service window (handlers.ts), so a
// successful card send is a free in-window utility message.
import { findMemberLoyaltyTokenByPhone } from '@/infrastructure/supabase/repositories/member-loyalty-repository'
import { checkMarketingConsent } from '@/application/check-marketing-consent'
import { promptMarketingOptin } from '@/application/prompt-marketing-optin'
import { uploadLoyaltyQr } from '@/infrastructure/supabase/storage'
import { sendImageMessage } from '@/infrastructure/whatsapp/messaging'

const CARD_CAPTION = '出示此碼儲印花\nShow this to collect stamps'

export async function handleMyCard(
  phoneNumberId: string,
  phone: string,
  restaurantId: string
): Promise<void> {
  const member = await findMemberLoyaltyTokenByPhone(phone, restaurantId)
  if (!member?.loyaltyToken) return

  const consent = await checkMarketingConsent({ restaurantId, phoneE164: phone })
  if (!consent.allowed) {
    await promptMarketingOptin({
      restaurantId,
      phoneE164: phone,
      source: `my_card_${member.memberId}`,
    })
    return
  }

  const qrUrl = await uploadLoyaltyQr(member.loyaltyToken)
  await sendImageMessage(phoneNumberId, phone, qrUrl, CARD_CAPTION)
}
