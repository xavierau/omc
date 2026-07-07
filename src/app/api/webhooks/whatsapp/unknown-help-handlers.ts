import {
  sendTextMessage,
  sendInteractiveButtons,
  sendInteractiveList,
} from '@/infrastructure/whatsapp/messaging'
import { findMemberByPhone } from '@/infrastructure/supabase/repositories/member-repository'
import { getRestaurantRedirect } from '@/infrastructure/supabase/repositories/restaurant-repository'
import { hasActiveRewards } from '@/infrastructure/supabase/repositories/reward-repository'
import { Language } from '@/domain/value-objects/language'
import { buildContactUrl } from '@/domain/services/contact-redirect'
import { resolveLanguageForMember } from './resolve-language'
import {
  buildFallbackMenu,
  UNKNOWN_EN,
  UNKNOWN_ZH,
  JOIN_INVITE_EN,
  JOIN_INVITE_ZH,
  OPTIONS_BUTTON_EN,
  OPTIONS_BUTTON_ZH,
  MEMBER_OPTIONS_EN,
  MEMBER_OPTIONS_ZH,
  JOIN_OPTION_EN,
  JOIN_OPTION_ZH,
  type MenuOption,
} from './fallback-menu'

const HELP_EN =
  'Available commands:\n' +
  '• POINTS / 積分 — Check your balance\n' +
  '• REWARDS / 獎賞 — View rewards\n' +
  '• REDEEM <code> / 兌換 <代碼> — Use a coupon\n' +
  '• CARD / 我的會員碼 — Get your stamp-card QR\n' +
  '• STOP / 退訂 — Unsubscribe\n' +
  '• LANG EN / 語言 中文 — Change language'

const HELP_ZH =
  '可用指令：\n' +
  '• POINTS / 積分 — 查詢餘額\n' +
  '• REWARDS / 獎賞 — 查看獎賞\n' +
  '• REDEEM <代碼> / 兌換 <代碼> — 使用優惠券\n' +
  '• CARD / 我的會員碼 — 取得您的儲印花會員碼\n' +
  '• STOP / 退訂 — 停止接收訊息\n' +
  '• LANG EN / 語言 中文 — 切換語言'

export async function handleHelp(
  phoneNumberId: string,
  phone: string,
  restaurantId: string
) {
  const member = await findMemberByPhone(restaurantId, phone)
  if (!member) {
    return sendJoinInvite(phoneNumberId, phone, restaurantId)
  }
  const language = await resolveLanguageForMember(member, restaurantId)
  const body = language.equals(Language.EN) ? HELP_EN : HELP_ZH
  return sendTextMessage(phoneNumberId, phone, body)
}

export async function handleUnknown(
  phoneNumberId: string,
  phone: string,
  restaurantId: string
) {
  const member = await findMemberByPhone(restaurantId, phone)
  const language = await resolveLanguageForMember(member, restaurantId)
  const isEn = language.equals(Language.EN)

  // Contact is NOT member-only: surface it to members and non-members alike
  // whenever a valid redirect number is configured. An invalid stored number
  // yields a null url ⇒ the row is omitted (no regression to today's menu).
  const { redirectNumber, redirectLabel } = await getRestaurantRedirect(restaurantId)
  const contactRow: MenuOption | null =
    redirectNumber && buildContactUrl(redirectNumber)
      ? { id: 'CONTACT', title: redirectLabel }
      : null

  const body = member
    ? isEn ? UNKNOWN_EN : UNKNOWN_ZH
    : isEn ? JOIN_INVITE_EN : JOIN_INVITE_ZH
  let baseOptions = member
    ? isEn ? MEMBER_OPTIONS_EN : MEMBER_OPTIONS_ZH
    : [isEn ? JOIN_OPTION_EN : JOIN_OPTION_ZH]

  // Hide "View Rewards" when the restaurant has no active rewards — the option
  // would otherwise lead only to a dead "no rewards" reply.
  if (member && !(await hasActiveRewards(restaurantId))) {
    baseOptions = baseOptions.filter((o) => o.id !== 'REWARDS')
  }

  const options = [...baseOptions, ...(contactRow ? [contactRow] : [])]
  const buttonText = isEn ? OPTIONS_BUTTON_EN : OPTIONS_BUTTON_ZH

  const menu = buildFallbackMenu(body, buttonText, options)
  if (menu.kind === 'buttons') {
    return sendInteractiveButtons(phoneNumberId, phone, body, menu.buttons)
  }
  return sendInteractiveList(
    phoneNumberId,
    phone,
    menu.bodyText,
    menu.buttonText,
    menu.sections
  )
}

async function sendJoinInvite(
  phoneNumberId: string,
  phone: string,
  restaurantId: string
) {
  const language = await resolveLanguageForMember(null, restaurantId)
  const body = language.equals(Language.EN) ? JOIN_INVITE_EN : JOIN_INVITE_ZH
  const button = language.equals(Language.EN) ? JOIN_OPTION_EN : JOIN_OPTION_ZH
  return sendInteractiveButtons(phoneNumberId, phone, body, [button])
}
