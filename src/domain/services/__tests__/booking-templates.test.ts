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
import { TEMPLATE_KINDS } from '@/domain/value-objects/booking-config'
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

  it('maps app languages to Meta codes', () => {
    expect(metaLanguageCode('en')).toBe('en')
    expect(metaLanguageCode('zh_hk')).toBe('zh_HK')
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
