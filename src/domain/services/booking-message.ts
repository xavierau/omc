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

export type BookingMessageKind = BookingTemplateKind

export interface BookingMessageDetails {
  restaurantName: string
  name: string | null
  date: string
  time: string
  partySize: number
  declineReason?: string | null
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
  }
}

type Copy = (d: Record<string, string>) => string

const EN: Record<BookingMessageKind, Copy> = {
  received: (d) =>
    `Hi ${d.name}, we've received your booking request at ${d.restaurant} for ${d.party_size} on ${d.date} at ${d.time}. The restaurant will confirm it shortly.`,
  confirmed: (d) =>
    `Hi ${d.name}, your booking at ${d.restaurant} for ${d.party_size} on ${d.date} at ${d.time} is confirmed. See you then!`,
  declined: (d) =>
    `Hi ${d.name}, sorry, ${d.restaurant} can't take your booking for ${d.party_size} on ${d.date} at ${d.time}.${d.reason !== '-' ? ` Reason: ${d.reason}` : ''}`,
  reminder: (d) => `Reminder: your booking at ${d.restaurant} for ${d.party_size} is today at ${d.time}.`,
}

const ZH: Record<BookingMessageKind, Copy> = {
  received: (d) =>
    `${d.name}你好,我們已收到你在${d.restaurant}的訂座要求:${d.date} ${d.time},${d.party_size}位。餐廳確認後會再通知你。`,
  confirmed: (d) => `${d.name}你好,你在${d.restaurant}的訂座已確認:${d.date} ${d.time},${d.party_size}位。到時見!`,
  declined: (d) =>
    `${d.name}你好,很抱歉,${d.restaurant}未能接受你的訂座:${d.date} ${d.time},${d.party_size}位。${d.reason !== '-' ? `原因:${d.reason}` : ''}`,
  reminder: (d) => `提提你:你今天 ${d.time} 在${d.restaurant}有${d.party_size}位的訂座。`,
}

/** Free-form text for a diner whose 24-hour service window is open. */
export function buildBookingText(kind: BookingMessageKind, language: LanguageCode, details: BookingMessageDetails): string {
  const params = buildBookingTemplateParams(details)
  return (language === 'en' ? EN : ZH)[kind](params)
}
