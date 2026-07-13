import {
  sendTextMessage,
  sendInteractiveButtons,
  sendInteractiveList,
} from '@/infrastructure/whatsapp/messaging'
import { findMemberByPhone } from '@/infrastructure/supabase/repositories/member-repository'
import {
  getRestaurantRedirect,
  getReplyConfig,
} from '@/infrastructure/supabase/repositories/restaurant-repository'
import { hasActiveRewards } from '@/infrastructure/supabase/repositories/reward-repository'
import { Language } from '@/domain/value-objects/language'
import { buildContactUrl } from '@/domain/services/contact-redirect'
import type { LocalizedText } from '@/domain/services/reply-config'
import { resolveLanguageForMember } from './resolve-language'
import {
  buildFallbackMenu,
  buildHelpText,
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

// Pick a tenant's custom message for the active language, or null to signal
// "use the stock default".
function customFor(text: LocalizedText, isEn: boolean): string | null {
  return isEn ? text.en : text.zh
}

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
  const isEn = language.equals(Language.EN)
  const config = await getReplyConfig(restaurantId)
  // A tenant-authored HELP overrides everything; otherwise the default lists
  // only the functions still enabled.
  const body =
    customFor(config.text.help, isEn) ?? buildHelpText(isEn, config.features)
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

  // Independent tenant reads — fetch together. hasActiveRewards is deferred
  // because it's only consulted for an enabled-rewards member.
  const [config, { redirectNumber, redirectLabel }] = await Promise.all([
    getReplyConfig(restaurantId),
    // Contact is NOT member-only: surface it to members and non-members alike
    // whenever a valid redirect number is configured. An invalid stored number
    // yields a null url ⇒ the row is omitted (no regression to today's menu).
    getRestaurantRedirect(restaurantId),
  ])
  const contactRow: MenuOption | null =
    redirectNumber && buildContactUrl(redirectNumber)
      ? { id: 'CONTACT', title: redirectLabel }
      : null

  const body = member
    ? customFor(config.text.unknown, isEn) ?? (isEn ? UNKNOWN_EN : UNKNOWN_ZH)
    : customFor(config.text.join, isEn) ?? (isEn ? JOIN_INVITE_EN : JOIN_INVITE_ZH)
  let baseOptions = member
    ? isEn ? MEMBER_OPTIONS_EN : MEMBER_OPTIONS_ZH
    : [isEn ? JOIN_OPTION_EN : JOIN_OPTION_ZH]

  if (member) {
    // Drop a function's row when the tenant disabled it (REPLY-003). Rewards
    // additionally stays hidden when there are no active rewards (REPLY-002) —
    // short-circuit skips that query when rewards is already off.
    if (!config.features.points) {
      baseOptions = baseOptions.filter((o) => o.id !== 'POINTS')
    }
    if (!config.features.rewards || !(await hasActiveRewards(restaurantId))) {
      baseOptions = baseOptions.filter((o) => o.id !== 'REWARDS')
    }
    // Hide the HELP button when disabled (REPLY-004). Button only: the typed
    // HELP / 幫助 command still routes to handleHelp regardless.
    if (!config.features.help) {
      baseOptions = baseOptions.filter((o) => o.id !== 'HELP')
    }
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
  const isEn = language.equals(Language.EN)
  const config = await getReplyConfig(restaurantId)
  const body =
    customFor(config.text.join, isEn) ?? (isEn ? JOIN_INVITE_EN : JOIN_INVITE_ZH)
  const button = isEn ? JOIN_OPTION_EN : JOIN_OPTION_ZH
  return sendInteractiveButtons(phoneNumberId, phone, body, [button])
}
