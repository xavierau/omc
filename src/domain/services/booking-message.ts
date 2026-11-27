/**
 * BOOK-001: what the diner is told about their booking request.
 *
 * Transactional only (R21): no offers, no links to promotions. Notes are
 * never part of any message (they may hold health information), and the
 * diner's name is flattened to one line and capped before it is used (R16),
 * so a name cannot inject extra lines or a template parameter Meta rejects.
 * Diner copy is provisional until the owner approves it (spec OQ7).
 */
import type { LanguageCode } from '@/domain/value-objects/language'
import type { BookingTemplateKind } from '@/domain/value-objects/booking-config'
import { formatMoney, type Money } from '@/domain/value-objects/money'

export type BookingMessageKind = BookingTemplateKind

export interface BookingMessageDetails {
  restaurantName: string
  name: string | null
  date: string
  time: string
  partySize: number
  declineReason?: string | null
  /** BOOK-014 W4 (spec AC-12): a declined booking's paid deposit, refunded in full. */
  depositRefund?: Money | null
  /** BOOK-014 W4 (spec AC-11): the staff booking's deposit request: amount, hold end (HK 'YYYY-MM-DD HH:MM') and the /p link. */
  depositRequest?: { amount: Money; holdUntil: string; linkUrl: string; linkToken: string } | null
}

/** BOOK-014 W4 (spec AC-12): the decline message's deposit line, in the diner's language. */
export function depositRefundLine(language: LanguageCode, amount: Money): string {
  const x = formatMoney(amount)
  return language === 'en' ? `Your deposit ${x} will be refunded.` : `你的訂金 ${x} 將會退回。`
}

export const TEMPLATE_PARAM_NAME_MAX = 60
const TEMPLATE_PARAM_MAX = 200

/** One line, single spaces, capped by code points (R16). */
export function sanitizeTemplateParam(value: string | null | undefined, max: number = TEMPLATE_PARAM_MAX): string {
  const flat = (value ?? '').replace(/[\s\u0000-\u001f\u007f]+/g, ' ').trim()
  return [...flat].slice(0, max).join('')
}

/**
 * Named template parameters W3's booking templates declare. Never carries
 * notes.
 */
export function buildBookingTemplateParams(details: BookingMessageDetails): Record<string, string> {
  return {
    restaurant: sanitizeTemplateParam(details.restaurantName),
    name: sanitizeTemplateParam(details.name, TEMPLATE_PARAM_NAME_MAX),
    date: details.date,
    time: details.time,
    party_size: String(details.partySize),
    reason: sanitizeTemplateParam(details.declineReason) || '-',
    // BOOK-014 W4: only the deposit request's body names these.
    amount: details.depositRequest ? formatMoney(details.depositRequest.amount) : '',
    hold_until: details.depositRequest?.holdUntil ?? '',
  }
}

const NAMED_PARAM = /\{\{(\w+)\}\}/g

/**
 * F3: the named params ONE stored template's BODY declares, filled from the
 * booking. Rows keep the body they were submitted with (an approved old body
 * next to a resubmitted new one), and Meta refuses a send with an extra or a
 * missing named param. Null when the body names a param the sender cannot fill.
 */
export function bookingParamsForBody(body: string, details: BookingMessageDetails, language?: LanguageCode): Record<string, string> | null {
  const all = buildBookingTemplateParams(details)
  // BOOK-014 W4 (spec AC-12): an approved declined template has no deposit sentence, so it rides in {{reason}}.
  if (details.depositRefund && language) {
    const line = depositRefundLine(language, details.depositRefund)
    all.reason = all.reason === '-' ? line : sanitizeTemplateParam(`${all.reason} · ${line}`)
  }
  const names = [...new Set([...body.matchAll(NAMED_PARAM)].map((m) => m[1]))]
  if (names.some((name) => !(name in all))) return null
  return Object.fromEntries(names.map((name) => [name, all[name]]))
}

type Copy = (d: Record<string, string>) => string

// F3: confirmed, declined and the en reminder follow the owner-approved
// template copy (2026-11-12), the zh_HK reminder the copy approved on
// 2026-11-13 (BOOK-002 F1); free text may leave out an absent reason.
const EN: Record<BookingMessageKind, Copy> = {
  received: (d) =>
    `Hi ${d.name}, we've received your booking request at ${d.restaurant} for ${d.party_size} on ${d.date} at ${d.time}. The restaurant will confirm it shortly.`,
  confirmed: (d) =>
    `Your table booking is confirmed. Restaurant: ${d.restaurant}. Date: ${d.date}. Time: ${d.time}. Party size: ${d.party_size}. If your plans change, please reply to this message to let the restaurant know.`,
  declined: (d) =>
    `Sorry, the restaurant could not accept your booking request for ${d.date} at ${d.time}.${d.reason !== '-' ? ` Reason: ${d.reason}.` : ''} You are welcome to choose another time and send a new request.`,
  // F8: the 3h window can open the evening before, so the date, never "today".
  reminder: (d) =>
    `This is a reminder of your upcoming table booking at ${d.restaurant} on ${d.date} at ${d.time}. If you can no longer make it, please reply to this message to let the restaurant know.`,
  // BOOK-013: staff edit / cancel (owner decision 6).
  changed: (d) =>
    `Your booking at ${d.restaurant} has been changed. New date: ${d.date}. New time: ${d.time}. Party size: ${d.party_size}. If this is not right, please reply to this message to let the restaurant know.`,
  cancelled: (d) =>
    `Your booking at ${d.restaurant} on ${d.date} at ${d.time} has been cancelled. If you have any questions, please reply to this message to contact the restaurant.`,
  // BOOK-014 W4: in-session the link goes in the text (the template carries it as its button).
  deposit_request: (d) =>
    `Your table at ${d.restaurant} on ${d.date} at ${d.time} for ${d.party_size} is held for you. To confirm it, please pay the deposit of ${d.amount} by ${d.hold_until}: ${d.link}`,
}

const ZH: Record<BookingMessageKind, Copy> = {
  received: (d) =>
    `${d.name}你好,我們已收到你在${d.restaurant}的訂座要求:${d.date} ${d.time},${d.party_size}位。餐廳確認後會再通知你。`,
  confirmed: (d) =>
    `你的訂座已確認。餐廳:${d.restaurant}。日期:${d.date}。時間:${d.time}。人數:${d.party_size}位。如行程有變,請直接回覆此訊息通知餐廳。`,
  declined: (d) =>
    `很抱歉,餐廳未能接受你在${d.date} ${d.time}的訂座要求。${d.reason !== '-' ? `原因:${d.reason}。` : ''}歡迎選擇其他時間再次提交訂座要求。`,
  reminder: (d) => `提提你,你在${d.restaurant}的訂座將於${d.date} ${d.time}開始。如未能出席,請直接回覆此訊息通知餐廳。`,
  changed: (d) =>
    `你在${d.restaurant}的訂座已更改。新日期:${d.date}。新時間:${d.time}。人數:${d.party_size}位。如有問題,請直接回覆此訊息通知餐廳。`,
  cancelled: (d) => `你在${d.restaurant}於${d.date} ${d.time}的訂座已取消。如有疑問,請直接回覆此訊息聯絡餐廳。`,
  deposit_request: (d) =>
    `我們已為你在${d.restaurant}保留${d.date} ${d.time}的座位,共${d.party_size}位。請於${d.hold_until}前繳付訂金${d.amount},以確認你的訂座:${d.link}`,
}

/** BOOK-014 W4: a free text's deposit line (decline), appended after the default or the restaurant's own wording. */
export function withDepositLine(text: string, language: LanguageCode, details: BookingMessageDetails): string {
  return details.depositRefund ? `${text} ${depositRefundLine(language, details.depositRefund)}` : text
}

/** Free-form text for a diner whose 24-hour service window is open. */
export function buildBookingText(kind: BookingMessageKind, language: LanguageCode, details: BookingMessageDetails): string {
  const params = { ...buildBookingTemplateParams(details), link: details.depositRequest?.linkUrl ?? '' }
  return withDepositLine((language === 'en' ? EN : ZH)[kind](params), language, details)
}
