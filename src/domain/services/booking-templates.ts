/**
 * BOOK-001 W3 (AC-1, AC-14, AC-15): the four booking UTILITY templates each
 * restaurant gets when it turns on Simple booking, in zh_HK and en.
 *
 * Copy is strictly transactional (R21): no offers, no links, never the diner's
 * notes. Parameters are the NAMED ones W1's sender fills
 * (buildBookingTemplateParams: restaurant, name, date, time, party_size,
 * reason), already flattened and capped there (R16). Meta refuses a body that
 * starts or ends with a parameter, and one with too few words per parameter
 * (2388293). F3: confirmed, declined and the en reminder carry the copy the
 * owner approved on 2026-11-12; received is the body already at Meta. BOOK-002
 * F1: Meta rejected the old zh_HK reminder after review (it was never
 * approved), so it carries the copy the owner approved on 2026-11-13. Rows
 * keep the body they were submitted with, so the sender fills each row's own
 * params (bookingParamsForBody).
 */
import type { TemplateComponent, TemplateStatus } from '../entities/whatsapp-template'
import type { BookingTemplateKind } from '../value-objects/booking-config'
import { TEMPLATE_LANGUAGES } from '../value-objects/booking-config'
import type { LanguageCode } from '../value-objects/language'

export const BOOKING_TEMPLATE_LANGUAGES = TEMPLATE_LANGUAGES

const BODIES: Record<BookingTemplateKind, Record<LanguageCode, string>> = {
  received: {
    en: 'Hi {{name}}, we have received your booking request at {{restaurant}} for {{party_size}} on {{date}} at {{time}}. The restaurant will confirm it shortly.',
    zh_hk: '你好{{name}},我們已收到你在{{restaurant}}的訂座要求:{{date}} {{time}},{{party_size}}位。餐廳確認後會再通知你。',
  },
  confirmed: {
    en: 'Your table booking is confirmed. Restaurant: {{restaurant}}. Date: {{date}}. Time: {{time}}. Party size: {{party_size}}. If your plans change, please reply to this message to let the restaurant know.',
    zh_hk: '你的訂座已確認。餐廳:{{restaurant}}。日期:{{date}}。時間:{{time}}。人數:{{party_size}}位。如行程有變,請直接回覆此訊息通知餐廳。',
  },
  declined: {
    en: 'Sorry, the restaurant could not accept your booking request for {{date}} at {{time}}. Reason: {{reason}}. You are welcome to choose another time and send a new request.',
    zh_hk: '很抱歉,餐廳未能接受你在{{date}} {{time}}的訂座要求。原因:{{reason}}。歡迎選擇其他時間再次提交訂座要求。',
  },
  // F8 (review #6): the reminder window can open the evening before, so it
  // states the booking date, never "today".
  reminder: {
    en: 'This is a reminder of your upcoming table booking at {{restaurant}} on {{date}} at {{time}}. If you can no longer make it, please reply to this message to let the restaurant know.',
    zh_hk: '提提你,你在{{restaurant}}的訂座將於{{date}} {{time}}開始。如未能出席,請直接回覆此訊息通知餐廳。',
  },
}

export function bookingTemplateBody(kind: BookingTemplateKind, language: LanguageCode): string {
  return BODIES[kind][language]
}

/** BODY only: no header, footer or buttons (R21: no links). Default or custom text alike. */
export function bookingTemplateComponents(text: string): TemplateComponent[] {
  return [{ type: 'BODY', text }]
}

const META_LANGUAGE: Record<LanguageCode, string> = { en: 'en', zh_hk: 'zh_HK' }

export function metaLanguageCode(language: LanguageCode): string {
  return META_LANGUAGE[language]
}

/** Template names are unique per WABA forever, so each attempt gets a fresh suffix. */
export function mintBookingTemplateName(kind: BookingTemplateKind, suffix: string): string {
  return `booking_${kind}_${suffix}`
}

/** What the settings page shows for one template, and what drives resubmission. */
export type BookingTemplateStatus = 'approved' | 'pending' | 'rejected' | 'failed' | 'not_submitted'

const STATUS_BY_ROW: Record<TemplateStatus, BookingTemplateStatus> = {
  approved: 'approved',
  pending: 'pending',
  paused: 'pending',
  rejected: 'rejected',
  disabled: 'rejected',
  deleted: 'rejected',
  // A stored draft never reached Meta: the submit call failed.
  draft: 'failed',
}

export function bookingTemplateStatus(row: { status: TemplateStatus } | null): BookingTemplateStatus {
  return row ? STATUS_BY_ROW[row.status] : 'not_submitted'
}

export function needsSubmission(status: BookingTemplateStatus): boolean {
  return status === 'rejected' || status === 'failed' || status === 'not_submitted'
}

export type BookingTemplateStatuses = Record<BookingTemplateKind, Record<LanguageCode, BookingTemplateStatus>>
