// BOOK-002 B2-01 (AC-4, R22): the custom booking message validator shared by
// the editor and the API. Errors block the save; warnings only inform.
import { describe, it, expect } from 'vitest'
import {
  BOOKING_TEMPLATE_BODY_MAX,
  PROMOTIONAL_TERMS,
  ZH_CHARS_PER_PLACEHOLDER,
  allowedBookingPlaceholders,
  normalizeBookingTemplateBody,
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

// BOOK-002 F1 C5: a bare domain or short link is a link too (review: kushiro.hk/offers).
describe('validateBookingTemplateBody bare domains and short links (C5)', () => {
  it.each([
    'kushiro.hk/offers',
    'see kushiro.hk for details',
    'Visit Kushiro.HK today',
    'wa.me/85291234567',
    'bit.ly/abc123',
    't.co/xyz',
    'tinyurl.com/kushiro',
    'shop.example.com',
    'write to info@kushiro.hk',
    '請到kushiro.hk訂座',
  ])('refuses %s', (text) => {
    expect(errorCodes('received', 'en', `${EN_OK} ${text} now.`)).toContain('link')
  })

  it.each(['Dr. Chan will greet you', 'arrive by 7.30pm', 'it takes 1.5 hours', 'e.g. a window seat', 'our company team', 'No.5 table', 'see you.Thanks'])(
    'allows %s',
    (text) => {
      expect(errorCodes('received', 'en', `${EN_OK} ${text} soon.`)).toEqual([])
    }
  )
})

// BOOK-002 F1 C1: the pipeline submits text with full-width braces ASCII-ised
// (prepare-template-components.ts), so the validator checks that same text.
describe('validateBookingTemplateBody on full-width placeholders (C1)', () => {
  it('normalizes full-width braces to ASCII and trims', () => {
    expect(normalizeBookingTemplateBody('  Hi ｛｛name｝｝ on ｛｛date｝｝ \n')).toBe('Hi {{name}} on {{date}}')
  })

  it('refuses ｛｛table｝｝ as an unknown placeholder', () => {
    const result = validateBookingTemplateBody('received', 'en', `Your ｛｛table｝｝ ${EN_OK}`)
    expect(result.errors).toContainEqual({ code: 'unknown_placeholder', detail: '{{table}}' })
  })

  it('counts ｛｛date｝｝ and ｛｛time｝｝ as the date and time', () => {
    expect(errorCodes('received', 'en', EN_OK.replace('{{date}}', '｛｛date｝｝').replace('{{time}}', '｛｛time｝｝'))).toEqual([])
  })

  it('a full-width duplicate is a duplicate', () => {
    expect(errorCodes('received', 'en', `${EN_OK} Again on ｛｛date｝｝ as planned.`)).toEqual(['duplicate_placeholder'])
  })

  it('a full-width placeholder at the start or end is at the edge', () => {
    expect(errorCodes('received', 'en', `｛｛name｝｝ ${EN_OK}`)).toContain('placeholder_at_edge')
    expect(errorCodes('received', 'en', `${EN_OK} See you ｛｛name｝｝`)).toContain('placeholder_at_edge')
  })

  it('a full-width {{date}} still satisfies the required check in zh_HK', () => {
    expect(errorCodes('received', 'zh_hk', '你的訂座在｛｛date｝｝ ｛｛time｝｝開始,請準時到達餐廳,謝謝你的支持。')).toEqual([])
  })
})

describe('validateBookingTemplateBody warnings (save allowed)', () => {
  it('warns when English has fewer than 3 fixed words per placeholder', () => {
    // 4 words / 2 placeholders = 2.0
    expect(warningCodes('en', 'Booked on {{date}} at {{time}} thanks.')).toEqual(['low_ratio'])
    // 6 words / 2 placeholders = 3.0, at the floor
    expect(warningCodes('en', 'Booked on {{date}} at {{time}} thanks, see you.')).toEqual([])
  })

  // Prod (2026-11-12/13, subcode 2388293): Meta rejected, after review, the
  // zh_HK reminder at 3.25 non-placeholder characters per placeholder and one
  // at 3.0. BOOK-002 F1: the floor is 6, the same as the default-copy test.
  const OLD_REMINDER_ZH_325 = '提提你:你在{{restaurant}}有{{party_size}}位的訂座:{{date}} {{time}}。'

  it('the zh_HK floor is 6 non-placeholder characters per placeholder', () => {
    expect(ZH_CHARS_PER_PLACEHOLDER).toBe(6)
  })

  it('zh_HK below 6 per placeholder warns: the Meta-rejected 3.25 reminder, 3.0, 4.0 and 5.75', () => {
    expect(validateBookingTemplateBody('reminder', 'zh_hk', OLD_REMINDER_ZH_325).warnings).toEqual([
      { code: 'low_ratio', detail: '3.25' },
    ])
    // 12 characters / 4 placeholders = 3.0
    expect(warningCodes('zh_hk', '提提你:{{restaurant}}有{{party_size}}位的:{{date}} {{time}}的訂座。')).toEqual(['low_ratio'])
    // 16 characters / 4 placeholders = 4.0 (passed the old floor of 4)
    expect(warningCodes('zh_hk', '提提你:你在{{restaurant}}有{{party_size}}位的訂座:{{date}} {{time}}到,謝。')).toEqual(['low_ratio'])
    // 23 characters / 4 placeholders = 5.75
    expect(warningCodes('zh_hk', '提提你:你在{{restaurant}}有{{party_size}}位的訂座:{{date}} {{time}}開始,請準時到達餐廳。')).toEqual(['low_ratio'])
  })

  it('zh_HK at 6 per placeholder does not warn', () => {
    // 24 characters / 4 placeholders = 6.0
    expect(warningCodes('zh_hk', '提提你:你在{{restaurant}}有{{party_size}}位的訂座:{{date}} {{time}}開始,請準時到達餐廳。謝')).toEqual([])
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
