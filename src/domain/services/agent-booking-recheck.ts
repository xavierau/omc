/**
 * BOOK-009 F1 (review P2-2, ruling 2026-11-20): at the PAP confirm-code step,
 * an agent booking is re-checked with the same rules every channel uses
 * (`parseBookingSubmission` with `bookingRulesAt(now, config)`), because up
 * to 30 minutes pass between the agent's POST and the diner's code.
 *
 * - The slot no longer passes (closed, outside hours, inside the notice, past
 *   the window, already past) → `rules`, with up to 3 bookable alternatives.
 * - Terms are required now and the booking stored none → `terms`.
 * - Anything else (e.g. a lowered party cap) is left to staff, as before.
 *
 * The replies are free-form WhatsApp text, inside the 24 h window the diner's
 * code just opened (no Meta template), zh-HK first, then English.
 */
import type { AgentBooking } from '@/domain/entities/booking-request'
import { parseBookingSubmission, type BookingSubmissionRules } from './booking-submission'
import { suggestionsForRefusal } from './agent-booking'
import type { SuggestedTime } from './booking-hours'

export type AgentBookingRecheck = { kind: 'ok' } | { kind: 'rules'; suggested: SuggestedTime[] } | { kind: 'terms' }

export type RecheckedBooking = Pick<AgentBooking, 'bookingDate' | 'bookingTime' | 'partySize' | 'name' | 'notes' | 'termsText'>

/** `fits` (BOOK-010 F1, review P2-1): the alternatives must also fit the party now; absent = rules only. */
export function recheckAgentBooking(
  b: RecheckedBooking,
  rules: BookingSubmissionRules,
  fits?: (date: string, time: string) => boolean
): AgentBookingRecheck {
  const body = { date: b.bookingDate, time: b.bookingTime, partySize: b.partySize, name: b.name, notes: b.notes, ...(b.termsText ? { acceptTerms: true } : {}) }
  const parsed = parseBookingSubmission(body, rules)
  if (parsed.ok) return { kind: 'ok' }
  const { errors } = parsed
  if (errors.date || errors.time) {
    const requested = { date: b.bookingDate, time: b.bookingTime, clock: rules, fits }
    return { kind: 'rules', suggested: suggestionsForRefusal(rules.hours, errors, requested) ?? [] }
  }
  return errors.acceptTerms ? { kind: 'terms' } : { kind: 'ok' }
}

const when = (s: SuggestedTime) => `${s.date} ${s.time}`

/** The diner's reply when the time is no longer bookable: why, the alternatives, then the booking link. */
export function timeUnavailableText(b: Pick<AgentBooking, 'bookingDate' | 'bookingTime'>, suggested: SuggestedTime[], link: string | null): string {
  const slot = `${b.bookingDate} ${b.bookingTime}`
  const times = suggested.map(when).join(', ')
  return [
    `你要求的 ${slot} 已不能預訂，這個訂座請求沒有送出給餐廳。`,
    ...(times ? [`仍可預訂：${times}`] : []),
    ...(link ? [`重新預訂：${link}`] : []),
    '',
    `${slot} can no longer be booked, so this request was not sent to the restaurant.`,
    ...(times ? [`You can still book: ${times}`] : []),
    ...(link ? [`Book again: ${link}`] : []),
  ].join('\n')
}

/** The diner's reply when the restaurant now has terms the booking never accepted. */
export function termsNowRequiredText(link: string | null): string {
  const zhWhere = link ? `請經你的助理或這個連結重新預訂：${link}` : '請經你的助理重新預訂。'
  const enWhere = link ? `Please book again through your agent or this link: ${link}` : 'Please book again through your agent.'
  return [
    `餐廳現有訂座須知，要先同意才可訂座，所以這個訂座請求沒有送出。${zhWhere}`,
    '',
    `The restaurant now has booking terms you need to agree to first, so this request was not sent. ${enWhere}`,
  ].join('\n')
}
