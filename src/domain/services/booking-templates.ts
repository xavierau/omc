/**
 * BOOK-001 W3 (AC-1, AC-14, AC-15): the four booking UTILITY templates each
 * restaurant gets when it turns on Simple booking, in zh_HK and en.
 *
 * Copy is strictly transactional (R21): no offers, no links, never the diner's
 * notes. Parameters are the NAMED ones W1's sender fills
 * (buildBookingTemplateParams: restaurant, name, date, time, party_size,
 * reason), already flattened and capped there (R16). Meta refuses a body that
 * starts or ends with a parameter. Diner copy awaits owner approval (spec OQ7).
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
    en: 'Hi {{name}}, your booking at {{restaurant}} for {{party_size}} on {{date}} at {{time}} is confirmed.',
    zh_hk: '你好{{name}},你在{{restaurant}}的訂座已確認:{{date}} {{time}},{{party_size}}位。',
  },
  declined: {
    en: 'Hi {{name}}, sorry, {{restaurant}} cannot take your booking for {{party_size}} on {{date}} at {{time}}. Reason: {{reason}}.',
    zh_hk: '你好{{name}},很抱歉,{{restaurant}}未能接受你的訂座:{{date}} {{time}},{{party_size}}位。原因:{{reason}}。',
  },
  reminder: {
    en: 'Reminder: your booking at {{restaurant}} for {{party_size}} is today at {{time}}.',
    zh_hk: '提提你:你今天 {{time}} 在{{restaurant}}有{{party_size}}位的訂座。',
  },
}

export function bookingTemplateBody(kind: BookingTemplateKind, language: LanguageCode): string {
  return BODIES[kind][language]
}

/** BODY only: no header, footer or buttons (R21: no links). */
export function bookingTemplateComponents(kind: BookingTemplateKind, language: LanguageCode): TemplateComponent[] {
  return [{ type: 'BODY', text: bookingTemplateBody(kind, language) }]
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
