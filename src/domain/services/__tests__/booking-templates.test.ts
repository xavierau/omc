// BOOK-001 W3-06 (R16, R21) and the template statuses W3-05 relies on.
// Booking templates are strictly transactional UTILITY copy: no offers, no
// links, never the diner's notes; every parameter is one W1's sender fills.
import { describe, it, expect } from 'vitest'
import {
  BOOKING_TEMPLATE_LANGUAGES,
  bookingTemplateBody,
  bookingTemplateComponents,
  bookingTemplateStatus,
  metaLanguageCode,
  mintBookingTemplateName,
  needsSubmission,
} from '../booking-templates'
import { buildBookingTemplateParams, sanitizeTemplateParam } from '../booking-message'
import { TEMPLATE_KINDS, type BookingTemplateKind } from '@/domain/value-objects/booking-config'
import type { LanguageCode } from '@/domain/value-objects/language'
import { validateTemplateName, extractParameters } from '@/domain/entities/whatsapp-template'
import { buildWhatsAppTemplate } from '@/test-utils/builders'
import { prepareTemplateComponents } from '../prepare-template-components'

const PROMOTIONAL_TERMS = [
  'offer', 'discount', 'promo', 'sale', 'free', 'coupon', 'deal', '% off', 'voucher', 'limited', 'special', 'member',
  '優惠', '折', '免費', '推廣', '限時', '特價', '會員', '禮券', '著數',
]
const URL_PATTERN = /https?:|www\.|\.com|\.io|\.hk|\/b\//i

const ALL = TEMPLATE_KINDS.flatMap((kind) => BOOKING_TEMPLATE_LANGUAGES.map((lang) => ({ kind, lang })))

describe('booking template copy (R21)', () => {
  it.each(ALL)('$kind/$lang has no promotional terms and no URLs', ({ kind, lang }) => {
    const body = bookingTemplateBody(kind, lang).toLowerCase()
    for (const term of PROMOTIONAL_TERMS) expect(body, term).not.toContain(term.toLowerCase())
    expect(body).not.toMatch(URL_PATTERN)
  })

  it.each(ALL)('$kind/$lang has only a BODY (no header, footer or buttons)', ({ kind, lang }) => {
    expect(bookingTemplateComponents(kind, lang).map((c) => c.type)).toEqual(['BODY'])
  })

  it.each(ALL)('$kind/$lang uses only the parameters the sender fills, never notes', ({ kind, lang }) => {
    const filled = Object.keys(buildBookingTemplateParams({ restaurantName: 'r', name: 'n', date: 'd', time: 't', partySize: 2 }))
    const used = extractParameters(buildWhatsAppTemplate({ components: bookingTemplateComponents(kind, lang) }))
    expect(used.length).toBeGreaterThan(0)
    for (const p of used) expect(filled).toContain(p)
    expect(used).not.toContain('notes')
  })

  it.each(ALL)('$kind/$lang neither starts nor ends with a parameter (Meta rejects that)', ({ kind, lang }) => {
    const body = bookingTemplateBody(kind, lang).trim()
    expect(body.startsWith('{{')).toBe(false)
    expect(body.endsWith('}}')).toBe(false)
  })

  it.each(ALL)('$kind/$lang gets a realistic example for every parameter (Meta review)', ({ kind, lang }) => {
    const [body] = prepareTemplateComponents(bookingTemplateComponents(kind, lang))
    const examples = (body.example as { bodyTextNamedParams: Array<{ example: string }> }).bodyTextNamedParams
    expect(examples.length).toBeGreaterThan(0)
    for (const e of examples) expect(e.example).not.toBe('example')
  })

  // F8 (review #6): the reminder can go out the evening before (the 3h window
  // crosses midnight), so it states the booking date, never "today".
  it.each(['en', 'zh_hk'] as const)('the %s reminder template states the booking date and time, not "today"', (lang) => {
    const body = bookingTemplateBody('reminder', lang)
    expect(body).toContain('{{date}}')
    expect(body).toContain('{{time}}')
    expect(body).not.toMatch(/today|今天|今日/i)
  })

  it('maps app languages to Meta codes', () => {
    expect(metaLanguageCode('en')).toBe('en')
    expect(metaLanguageCode('zh_hk')).toBe('zh_HK')
  })
})

// BOOK-001 F3: Meta rejected confirmed, declined and the en reminder (both
// rejected languages) with 2388293 Params Words Ratio Exceeds Limit. The
// owner-approved copy (2026-11-12) replaces them; received (both, pending at
// Meta) and the zh_HK reminder (approved) keep their stored bodies.
const APPROVED_COPY = {
  confirmed: {
    en: 'Your table booking is confirmed. Restaurant: {{restaurant}}. Date: {{date}}. Time: {{time}}. Party size: {{party_size}}. If your plans change, please reply to this message to let the restaurant know.',
    zh_hk: '你的訂座已確認。餐廳:{{restaurant}}。日期:{{date}}。時間:{{time}}。人數:{{party_size}}位。如行程有變,請直接回覆此訊息通知餐廳。',
  },
  declined: {
    en: 'Sorry, the restaurant could not accept your booking request for {{date}} at {{time}}. Reason: {{reason}}. You are welcome to choose another time and send a new request.',
    zh_hk: '很抱歉,餐廳未能接受你在{{date}} {{time}}的訂座要求。原因:{{reason}}。歡迎選擇其他時間再次提交訂座要求。',
  },
  reminder: {
    en: 'This is a reminder of your upcoming table booking at {{restaurant}} on {{date}} at {{time}}. If you can no longer make it, please reply to this message to let the restaurant know.',
  },
} as const

const UNCHANGED_COPY = {
  received: {
    en: 'Hi {{name}}, we have received your booking request at {{restaurant}} for {{party_size}} on {{date}} at {{time}}. The restaurant will confirm it shortly.',
    zh_hk: '你好{{name}},我們已收到你在{{restaurant}}的訂座要求:{{date}} {{time}},{{party_size}}位。餐廳確認後會再通知你。',
  },
  reminder: { zh_hk: '提提你:你在{{restaurant}}有{{party_size}}位的訂座:{{date}} {{time}}。' },
} as const

const entries = (copy: Record<string, Record<string, string>>) =>
  Object.entries(copy).flatMap(([kind, byLang]) =>
    Object.entries(byLang).map(([lang, body]) => ({ kind: kind as BookingTemplateKind, lang: lang as LanguageCode, body })))

describe('booking template copy (F3, owner-approved 2026-11-12)', () => {
  it.each(entries(APPROVED_COPY))('$kind/$lang is the approved copy', ({ kind, lang, body }) => {
    expect(bookingTemplateBody(kind, lang)).toBe(body)
  })

  it.each(entries(UNCHANGED_COPY))('$kind/$lang is byte-identical to the body stored at Meta', ({ kind, lang, body }) => {
    expect(bookingTemplateBody(kind, lang)).toBe(body)
  })
})

// Guard against 2388293 (Params Words Ratio Exceeds Limit). Meta does not
// publish the threshold; these floors are ours: 3 fixed words per parameter
// in English, 6 fixed CJK characters per parameter in Chinese.
const PLACEHOLDER = /\{\{\w+\}\}/g
const placeholderCount = (body: string) => (body.match(PLACEHOLDER) ?? []).length
const fixedText = (body: string) => body.replace(PLACEHOLDER, ' ')
const fixedEnglishWords = (body: string) => (fixedText(body).match(/[A-Za-z]+(?:'[A-Za-z]+)?/g) ?? []).length
const fixedCjkChars = (body: string) => (fixedText(body).match(/\p{Script=Han}/gu) ?? []).length
const EN_WORDS_PER_PARAM = 3
const ZH_CHARS_PER_PARAM = 6

// Bodies already at Meta that sit under the floor and must stay byte-identical
// (reminder zh_HK was approved at this ratio; received zh_HK is pending). Any
// edit to one of them makes it a new submission, which must meet the floor.
const FROZEN_BELOW_FLOOR: Partial<Record<`${BookingTemplateKind}/${LanguageCode}`, string>> = {
  'received/zh_hk': UNCHANGED_COPY.received.zh_hk,
  'reminder/zh_hk': UNCHANGED_COPY.reminder.zh_hk,
}

describe('booking template params-to-words floor (2388293 guard)', () => {
  it.each(ALL)('$kind/$lang has enough fixed text per parameter', ({ kind, lang }) => {
    const body = bookingTemplateBody(kind, lang)
    const params = placeholderCount(body)
    const fixed = lang === 'en' ? fixedEnglishWords(body) : fixedCjkChars(body)
    const floor = (lang === 'en' ? EN_WORDS_PER_PARAM : ZH_CHARS_PER_PARAM) * params
    if (FROZEN_BELOW_FLOOR[`${kind}/${lang}`] === body) return
    expect(fixed, `${fixed} fixed for ${params} params`).toBeGreaterThanOrEqual(floor)
  })

  it('counts fixed text, not the placeholders', () => {
    expect(fixedEnglishWords('Hi {{name}}, your table at {{restaurant}}.')).toBe(4)
    expect(fixedCjkChars('你好{{name}},餐廳:{{restaurant}}。')).toBe(4)
    expect(placeholderCount('a {{x}} b {{y}}')).toBe(2)
  })
})

describe('booking template parameters (R16)', () => {
  it('flattens a name with newlines/tabs to one line and caps it at 60 characters', () => {
    const params = buildBookingTemplateParams({
      restaurantName: 'Kushiro', name: `Chan\n\tTai   Man ${'x'.repeat(80)}`, date: 'd', time: 't', partySize: 2,
    })
    expect(params.name).not.toMatch(/[\n\t]|\s{2,}/)
    expect([...params.name].length).toBeLessThanOrEqual(60)
    expect(params.name.startsWith('Chan Tai Man x')).toBe(true)
  })

  it('never carries notes, even when the details object has them', () => {
    const details = { restaurantName: 'r', name: 'n', date: 'd', time: 't', partySize: 2, notes: 'allergic to nuts' }
    const params = buildBookingTemplateParams(details)
    expect(Object.keys(params)).not.toContain('notes')
    expect(JSON.stringify(params)).not.toContain('allergic')
  })

  it('sanitizeTemplateParam collapses control characters', () => {
    expect(sanitizeTemplateParam('a\r\n\u0000b')).toBe('a b')
  })
})

describe('template names and statuses', () => {
  it('mints a valid, per-attempt-unique name', () => {
    const a = mintBookingTemplateName('received', 'a1b2c3')
    expect(a).toBe('booking_received_a1b2c3')
    expect(validateTemplateName(a)).toBe(true)
  })

  it.each([
    [null, 'not_submitted'],
    ['draft', 'failed'],
    ['pending', 'pending'],
    ['paused', 'pending'],
    ['approved', 'approved'],
    ['rejected', 'rejected'],
    ['disabled', 'rejected'],
    ['deleted', 'rejected'],
  ] as const)('row status %s → %s', (status, expected) => {
    expect(bookingTemplateStatus(status === null ? null : { status })).toBe(expected)
  })

  it('resubmits only rejected, failed or never-submitted templates', () => {
    expect(needsSubmission('rejected')).toBe(true)
    expect(needsSubmission('failed')).toBe(true)
    expect(needsSubmission('not_submitted')).toBe(true)
    expect(needsSubmission('pending')).toBe(false)
    expect(needsSubmission('approved')).toBe(false)
  })
})
