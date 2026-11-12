// BOOK-002 B2-01 (AC-4, R22): the custom booking message validator shared by
// the editor and the API. Errors block the save; warnings only inform.
import { describe, it, expect } from 'vitest'
import {
  BOOKING_TEMPLATE_BODY_MAX,
  PROMOTIONAL_TERMS,
  allowedBookingPlaceholders,
  renderBookingTemplateBody,
  validateBookingTemplateBody,
} from '../booking-template-body'
import { bookingTemplateBody } from '../booking-templates'
import { TEMPLATE_KINDS, TEMPLATE_LANGUAGES } from '@/domain/value-objects/booking-config'

const EN_OK = 'Your table at {{restaurant}} is booked for {{date}} at {{time}} and we look forward to seeing you there soon.'
const errorCodes = (kind: 'received' | 'declined', lang: 'en' | 'zh_hk', body: string) =>
  validateBookingTemplateBody(kind, lang, body).errors.map((e) => e.code)
const warningCodes = (lang: 'en' | 'zh_hk', body: string) =>
  validateBookingTemplateBody('received', lang, body).warnings.map((w) => w.code)

describe('validateBookingTemplateBody errors (block the save)', () => {
  it('accepts a clean body with no errors and no warnings', () => {
    expect(validateBookingTemplateBody('received', 'en', EN_OK)).toEqual({ errors: [], warnings: [] })
  })

  it.each(['', '   ', '\n\t'])('refuses an empty body %j (and reports only that)', (body) => {
    expect(errorCodes('received', 'en', body)).toEqual(['empty'])
  })

  it('refuses a body over 1,024 characters, and accepts exactly 1,024', () => {
    const pad = (n: number) => `${'a'.repeat(n - EN_OK.length - 1)} ${EN_OK}`
    expect(pad(BOOKING_TEMPLATE_BODY_MAX)).toHaveLength(1024)
    expect(errorCodes('received', 'en', pad(BOOKING_TEMPLATE_BODY_MAX))).toEqual([])
    expect(errorCodes('received', 'en', pad(BOOKING_TEMPLATE_BODY_MAX + 1))).toEqual(['too_long'])
  })

  it.each(['see https://x.io', 'see http://x.io', 'see www.example.com', 'see HTTPS://X.IO', 'go WWW.shop.hk'])(
    'refuses a link: %s',
    (link) => {
      expect(errorCodes('received', 'en', `${EN_OK} ${link} for details.`)).toContain('link')
    }
  )

  it.each(['{{notes}}', '{{phone}}', '{{1}}', '{{ name }}', '{{Name}}', '{{}}'])('refuses an unknown placeholder %s', (token) => {
    const result = validateBookingTemplateBody('received', 'en', `Hello ${token}, ${EN_OK}`)
    expect(result.errors).toContainEqual({ code: 'unknown_placeholder', detail: token })
  })

  it('refuses a stray brace pair that is not a placeholder', () => {
    expect(errorCodes('received', 'en', `Hello {{name}, ${EN_OK}`)).toContain('unknown_placeholder')
  })

  it('allows {{reason}} only in the declined message', () => {
    expect(allowedBookingPlaceholders('declined')).toEqual(['name', 'restaurant', 'date', 'time', 'party_size', 'reason'])
    expect(allowedBookingPlaceholders('received')).toEqual(['name', 'restaurant', 'date', 'time', 'party_size'])
    const body = `${EN_OK} Reason given: {{reason}} as noted.`
    expect(errorCodes('declined', 'en', body)).toEqual([])
    expect(errorCodes('received', 'en', body)).toContain('unknown_placeholder')
  })

  it('refuses a body without {{date}} or without {{time}}', () => {
    expect(errorCodes('received', 'en', EN_OK.replace('{{date}}', 'Friday'))).toEqual(['missing_date'])
    expect(errorCodes('received', 'en', EN_OK.replace('{{time}}', 'noon'))).toEqual(['missing_time'])
  })

  it.each([
    ['starts', `{{name}} ${EN_OK}`],
    ['ends', `${EN_OK} See you {{name}}`],
    ['starts after whitespace', `  {{name}} ${EN_OK}`],
  ])('refuses a body that %s with a placeholder', (_, body) => {
    expect(errorCodes('received', 'en', body)).toContain('placeholder_at_edge')
  })

  it('refuses a placeholder used twice', () => {
    const result = validateBookingTemplateBody('received', 'en', `${EN_OK} Again on {{date}} as planned.`)
    expect(result.errors).toEqual([{ code: 'duplicate_placeholder', detail: '{{date}}' }])
  })
})

describe('validateBookingTemplateBody warnings (save allowed)', () => {
  it('warns when English has fewer than 3 fixed words per placeholder', () => {
    // 4 words / 2 placeholders = 2.0
    expect(warningCodes('en', 'Booked on {{date}} at {{time}} thanks.')).toEqual(['low_ratio'])
    // 6 words / 2 placeholders = 3.0, at the floor
    expect(warningCodes('en', 'Booked on {{date}} at {{time}} thanks, see you.')).toEqual([])
  })

  // Prod (2026-11-12, subcode 2388293): Meta approved a zh_HK body at 3.25
  // non-placeholder characters per placeholder and rejected one at 3.0. Our
  // floor is 4, stricter than Meta, so 3.25 still warns (outcome recorded in
  // the BOOK-002 handoff).
  it('zh_HK below 4 non-placeholder characters per placeholder warns, including the prod-approved 3.25', () => {
    const approvedAt325 = bookingTemplateBody('reminder', 'zh_hk')
    expect(validateBookingTemplateBody('reminder', 'zh_hk', approvedAt325).warnings).toEqual([
      { code: 'low_ratio', detail: '3.25' },
    ])
    // 12 characters / 4 placeholders = 3.0 (the ratio Meta rejected)
    expect(warningCodes('zh_hk', '提提你:{{restaurant}}有{{party_size}}位的:{{date}} {{time}}的訂座。')).toEqual(['low_ratio'])
    // 16 characters / 4 placeholders = 4.0
    expect(warningCodes('zh_hk', '提提你:你在{{restaurant}}有{{party_size}}位的訂座:{{date}} {{time}}到,謝。')).toEqual([])
  })

  it('counts every non-space character outside placeholders in zh_HK, punctuation included', () => {
    const result = validateBookingTemplateBody('received', 'zh_hk', '日期:{{date}} 時間:{{time}}。')
    expect(result.warnings).toEqual([{ code: 'low_ratio', detail: '3.50' }])
  })

  it.each(['Enjoy a free dessert', 'Our member offer', 'Members enjoy it', 'Weekly offers', 'Big SALE tonight', 'Get 20% off', '享有會員優惠'])(
    'warns on a promotional term: %s',
    (phrase) => {
      expect(warningCodes('en', `${EN_OK} ${phrase} with us.`)).toContain('promotional_term')
    }
  )

  it('names the promotional term it found', () => {
    const result = validateBookingTemplateBody('received', 'en', `${EN_OK} A free gift awaits you.`)
    expect(result.warnings).toContainEqual({ code: 'promotional_term', detail: 'free' })
  })

  it('matches English terms as whole words only (no warning for "ideal" or "wholesale")', () => {
    expect(warningCodes('en', `${EN_OK} An ideal wholesale venue.`)).toEqual([])
  })

  it('the promotional terms list is the one the default copy is checked against', () => {
    expect(PROMOTIONAL_TERMS).toEqual(expect.arrayContaining(['offer', 'discount', 'free', '% off', '優惠', '會員']))
  })
})

describe('default bodies under the shared validator', () => {
  const all = TEMPLATE_KINDS.flatMap((kind) => TEMPLATE_LANGUAGES.map((lang) => ({ kind, lang })))
  it.each(all)('$kind/$lang default has no errors', ({ kind, lang }) => {
    expect(validateBookingTemplateBody(kind, lang, bookingTemplateBody(kind, lang)).errors).toEqual([])
  })
})

describe('renderBookingTemplateBody', () => {
  it('fills the named placeholders and leaves other text untouched', () => {
    const values = { name: 'Chan', date: '2026-11-20', time: '19:30' }
    expect(renderBookingTemplateBody('Hi {{name}}, {{date}} at {{time}} <b>', values)).toBe('Hi Chan, 2026-11-20 at 19:30 <b>')
  })

  it('renders an unknown placeholder as written', () => {
    expect(renderBookingTemplateBody('Hi {{notes}}', { name: 'x' })).toBe('Hi {{notes}}')
  })
})
