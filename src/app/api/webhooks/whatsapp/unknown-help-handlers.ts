import { sendTextMessage, sendInteractiveButtons } from '@/infrastructure/whatsapp/messaging'
import { findMemberByPhone } from '@/infrastructure/supabase/repositories/member-repository'
import { getRestaurantDefaultLanguage } from '@/infrastructure/supabase/repositories/restaurant-onboarding-repository'
import { Language } from '@/domain/value-objects/language'
import { resolvePreferredLanguage } from '@/domain/services/resolve-preferred-language'

const HELP_EN =
  'Available commands:\n' +
  '• POINTS / 積分 — Check your balance\n' +
  '• REWARDS / 獎賞 — View rewards\n' +
  '• REDEEM <code> / 兌換 <代碼> — Use a coupon\n' +
  '• STOP / 退訂 — Unsubscribe\n' +
  '• LANG EN / 語言 中文 — Change language'

const HELP_ZH =
  '可用指令：\n' +
  '• POINTS / 積分 — 查詢餘額\n' +
  '• REWARDS / 獎賞 — 查看獎賞\n' +
  '• REDEEM <代碼> / 兌換 <代碼> — 使用優惠券\n' +
  '• STOP / 退訂 — 停止接收訊息\n' +
  '• LANG EN / 語言 中文 — 切換語言'

const UNKNOWN_EN =
  "Sorry, I didn't understand that. Try POINTS / 積分 to check balance, or HELP / 幫助 for options."
const UNKNOWN_ZH =
  '抱歉，我不明白您的訊息。請輸入 POINTS / 積分 查詢餘額，或 HELP / 幫助 查看選項。'

const BUTTONS_EN = [
  { id: 'POINTS', title: 'Check Points' },
  { id: 'REWARDS', title: 'View Rewards' },
  { id: 'HELP', title: 'Help' },
]

const BUTTONS_ZH = [
  { id: 'POINTS', title: '查詢積分' },
  { id: 'REWARDS', title: '查看獎賞' },
  { id: 'HELP', title: '幫助' },
]

const JOIN_INVITE_EN =
  'Welcome! Join our rewards program to earn points on every visit, unlock exclusive coupons, and get special member-only offers.'
const JOIN_INVITE_ZH =
  '歡迎！加入我們的會員計劃，每次消費賺取積分、解鎖專屬優惠券，並獲取會員尊享禮遇。'

const JOIN_BUTTON_EN = { id: 'JOIN', title: 'Join Rewards' }
const JOIN_BUTTON_ZH = { id: 'JOIN', title: '加入會員' }

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
  if (!member) {
    return sendJoinInvite(phoneNumberId, phone, restaurantId)
  }

  const language = await resolveLanguageForMember(member, restaurantId)
  const body = language.equals(Language.EN) ? UNKNOWN_EN : UNKNOWN_ZH
  const buttons = language.equals(Language.EN) ? BUTTONS_EN : BUTTONS_ZH
  return sendInteractiveButtons(phoneNumberId, phone, body, buttons)
}

async function sendJoinInvite(
  phoneNumberId: string,
  phone: string,
  restaurantId: string
) {
  const language = await resolveLanguageForMember(null, restaurantId)
  const body = language.equals(Language.EN) ? JOIN_INVITE_EN : JOIN_INVITE_ZH
  const button = language.equals(Language.EN) ? JOIN_BUTTON_EN : JOIN_BUTTON_ZH
  return sendInteractiveButtons(phoneNumberId, phone, body, [button])
}

async function resolveLanguageForMember(
  member: { preferredLanguage: string | null } | null,
  restaurantId: string
): Promise<Language> {
  const defaultLanguage = await getRestaurantDefaultLanguage(restaurantId)
  return resolvePreferredLanguage(member, { defaultLanguage })
}
