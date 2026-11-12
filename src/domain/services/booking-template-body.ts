/**
 * BOOK-002 (AC-4, R22): rules for a restaurant's own booking message text,
 * shared by the editor (live feedback) and the API (the real gate).
 *
 * Errors block the save: Meta refuses these bodies outright, or they would
 * put a link or an unfillable parameter in front of diners. Warnings only
 * inform: a low fixed-text-per-placeholder ratio (Meta's 2388293 threshold is
 * unpublished; prod approved a zh_HK body at 3.25 and rejected one at 3.0) and
 * promotional wording in a UTILITY message (R21). The restaurant owns its text.
 */
import type { BookingTemplateKind } from '../value-objects/booking-config'
import type { LanguageCode } from '../value-objects/language'

export const BOOKING_TEMPLATE_BODY_MAX = 1024
const BASE_PLACEHOLDERS = ['name', 'restaurant', 'date', 'time', 'party_size']
const EN_WORDS_PER_PLACEHOLDER = 3
const ZH_CHARS_PER_PLACEHOLDER = 4

export const PROMOTIONAL_TERMS = [
  'offer', 'discount', 'promo', 'sale', 'free', 'coupon', 'deal', '% off', 'voucher', 'limited', 'special', 'member',
  '優惠', '折', '免費', '推廣', '限時', '特價', '會員', '禮券', '著數',
]

export type BookingBodyErrorCode =
  | 'empty' | 'too_long' | 'link' | 'unknown_placeholder' | 'missing_date' | 'missing_time'
  | 'placeholder_at_edge' | 'duplicate_placeholder'
export type BookingBodyWarningCode = 'low_ratio' | 'promotional_term'

export interface BookingBodyIssue<C extends string> {
  code: C
  detail?: string
}

export interface BookingBodyCheck {
  errors: BookingBodyIssue<BookingBodyErrorCode>[]
  warnings: BookingBodyIssue<BookingBodyWarningCode>[]
}

const TOKEN = /\{\{([^{}]*)\}\}/g
const LINK = /https?:\/\/|www\./i

/** The placeholders one kind of message may use ({{reason}} only when declined). */
export function allowedBookingPlaceholders(kind: BookingTemplateKind): string[] {
  return kind === 'declined' ? [...BASE_PLACEHOLDERS, 'reason'] : [...BASE_PLACEHOLDERS]
}

const tokensOf = (text: string) => [...text.matchAll(TOKEN)].map((m) => ({ token: m[0], name: m[1] }))

function placeholderErrors(kind: BookingTemplateKind, text: string): BookingBodyIssue<BookingBodyErrorCode>[] {
  const allowed = allowedBookingPlaceholders(kind)
  const tokens = tokensOf(text)
  const errors: BookingBodyIssue<BookingBodyErrorCode>[] = []
  for (const { token } of tokens.filter((t) => !allowed.includes(t.name))) errors.push({ code: 'unknown_placeholder', detail: token })
  const stray = text.replace(TOKEN, '').match(/\{\{|\}\}/)
  if (stray) errors.push({ code: 'unknown_placeholder', detail: stray[0] })
  const seen = new Set<string>()
  for (const { token } of tokens.filter((t) => allowed.includes(t.name))) {
    if (seen.has(token)) errors.push({ code: 'duplicate_placeholder', detail: token })
    seen.add(token)
  }
  if (!seen.has('{{date}}')) errors.push({ code: 'missing_date' })
  if (!seen.has('{{time}}')) errors.push({ code: 'missing_time' })
  return errors
}

function bodyErrors(kind: BookingTemplateKind, text: string): BookingBodyIssue<BookingBodyErrorCode>[] {
  if (text === '') return [{ code: 'empty' }]
  const errors: BookingBodyIssue<BookingBodyErrorCode>[] = []
  if ([...text].length > BOOKING_TEMPLATE_BODY_MAX) errors.push({ code: 'too_long' })
  if (LINK.test(text)) errors.push({ code: 'link' })
  if (text.startsWith('{{') || text.endsWith('}}')) errors.push({ code: 'placeholder_at_edge' })
  return [...errors, ...placeholderErrors(kind, text)]
}

function fixedPerPlaceholder(language: LanguageCode, text: string): number | null {
  const count = tokensOf(text).length
  if (count === 0) return null
  const fixed = text.replace(TOKEN, ' ')
  const amount = language === 'en'
    ? (fixed.match(/[A-Za-z]+(?:'[A-Za-z]+)?/g) ?? []).length
    : fixed.replace(/\s/g, '').length
  return amount / count
}

const isLatin = (term: string) => /^[\x20-\x7e]+$/.test(term)
const escape = (term: string) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function findsTerm(text: string, term: string): boolean {
  if (!isLatin(term)) return text.includes(term)
  const edge = (c: string) => (/\w/.test(c) ? '\\b' : '')
  // Whole words, plurals included ("offers", "members"), never "ideal" or "wholesale".
  const plural = /\w/.test(term[term.length - 1]) ? '(?:s|es)?' : ''
  return new RegExp(`${edge(term[0])}${escape(term)}${plural}${edge(term[term.length - 1])}`, 'i').test(text)
}

function bodyWarnings(language: LanguageCode, text: string): BookingBodyIssue<BookingBodyWarningCode>[] {
  const warnings: BookingBodyIssue<BookingBodyWarningCode>[] = []
  const ratio = fixedPerPlaceholder(language, text)
  const floor = language === 'en' ? EN_WORDS_PER_PLACEHOLDER : ZH_CHARS_PER_PLACEHOLDER
  if (ratio !== null && ratio < floor) warnings.push({ code: 'low_ratio', detail: ratio.toFixed(2) })
  const prose = text.replace(TOKEN, ' ')
  for (const term of PROMOTIONAL_TERMS.filter((t) => findsTerm(prose, t))) warnings.push({ code: 'promotional_term', detail: term })
  return warnings
}

/** Checks one message body for one kind and language (the text is trimmed first). */
export function validateBookingTemplateBody(kind: BookingTemplateKind, language: LanguageCode, body: string): BookingBodyCheck {
  const text = body.trim()
  const errors = bodyErrors(kind, text)
  if (errors.some((e) => e.code === 'empty')) return { errors, warnings: [] }
  return { errors, warnings: bodyWarnings(language, text) }
}

/** Fills {{name}}-style placeholders from values; anything else stays as written. Plain text, never HTML. */
export function renderBookingTemplateBody(body: string, values: Record<string, string>): string {
  return body.replace(TOKEN, (token, name: string) => (name in values ? values[name] : token))
}
