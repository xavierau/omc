// BOOK-009 W4 (spec AC-11, AC-13, AC-14): the OpenAPI description a personal
// agent reads carries the booking rules, the terms and /availability only when
// the restaurant set booking hours; without them it is today's document, byte
// for byte (fixture generated from the code at e89ef859, before W4).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildAgentBookingOpenApi, buildCollectionStatement, termsReplyText } from '../poppy-documents'
import { summarize } from '../booking-hours'
import { EMPTY_BOOKING_HOURS, type BookingHours } from '@/domain/value-objects/booking-hours'

const TODAY = '2026-11-19'
const lunchDinner = [
  { label: '午市', first: '12:00', last: '14:00' },
  { label: '晚市', first: '18:00', last: '21:30' },
]
const HOURS: BookingHours = {
  ...EMPTY_BOOKING_HOURS,
  weekly: { mon: [], tue: lunchDinner, wed: lunchDinner, thu: lunchDinner, fri: lunchDinner, sat: lunchDinner, sun: lunchDinner },
  intervalMinutes: 30,
  noticeHours: 2,
  aheadDays: 30,
  special: [
    { date: '2026-11-25', label: '休息', periods: [] },
    { date: '2027-03-01', periods: [] },
  ],
  tableMinutes: 120,
}
const TERMS = { zh_hk: '訂座保留 15 分鐘。', en: 'Tables are held for 15 minutes.' }

const BASE = {
  restaurantName: 'Cafe A',
  apiBaseUrl: `https://app.ohmyclient.io/api/poppy/${'A'.repeat(32)}`,
  maxPartySize: 8,
  statement: buildCollectionStatement('Cafe A', 'https://ohmyclient.io/privacy-policy.html'),
}
const FIXTURE = readFileSync(join(__dirname, 'fixtures/poppy-openapi-hours-null.json'), 'utf8')

type Doc = ReturnType<typeof buildAgentBookingOpenApi>
const createSchema = (doc: Doc) =>
  (doc.paths['/bookings'].post.requestBody.content['application/json'].schema as unknown) as {
    properties: Record<string, { type: string }>
    required: string[]
  }

describe('AC-14 hours not set: the OpenAPI document is unchanged', () => {
  it.each([
    ['no booking field', {}],
    ['booking: null', { booking: null }],
  ])('AC-14 %s → byte-for-byte the pre-BOOK-009 document', (_label, extra) => {
    expect(JSON.stringify(buildAgentBookingOpenApi({ ...BASE, ...extra }), null, 2) + '\n').toBe(FIXTURE)
  })
})

describe('AC-11 hours set: rules, availability and refusal codes are described', () => {
  const doc = buildAgentBookingOpenApi({ ...BASE, booking: { hours: HOURS, today: TODAY } })
  const text = doc.info.description

  it('AC-11 description carries the English summary of the window (special dates inside it only) and the table time', () => {
    const inWindow = { ...HOURS, special: [HOURS.special[0]] }
    expect(text).toContain(summarize(inWindow, 8, 'en'))
    expect(text).toContain('Tables are for 2 hours.')
    expect(text).toContain('25 Nov')
    expect(text).not.toContain('1 Mar')
  })

  it('AC-11 description points to GET /availability and explains field codes + suggested_times', () => {
    expect(text).toContain('GET /availability')
    for (const code of ['closed_day', 'outside_hours', 'too_soon', 'too_far', 'suggested_times']) expect(text).toContain(code)
  })

  it('AC-11 /availability is a listed signed-out GET with from, days (≤ min(31, aheadDays)) and party_size', () => {
    const op = (doc.paths as Record<string, Record<string, { operationId: string; parameters: Array<{ name: string; in: string; required: boolean; schema: { maximum?: number } }> }>>)['/availability'].get
    expect(op.operationId).toBe('getAvailability')
    const params = Object.fromEntries(op.parameters.map((p) => [p.name, p]))
    expect(params.from).toMatchObject({ in: 'query', required: true })
    expect(params.days).toMatchObject({ in: 'query', required: true, schema: { maximum: 30 } })
    expect(params.party_size).toMatchObject({ in: 'query', required: false, schema: { maximum: 8 } })
  })

  it('AC-11 days maximum is 31 when the window is longer', () => {
    const long = buildAgentBookingOpenApi({ ...BASE, booking: { hours: { ...HOURS, aheadDays: 90 }, today: TODAY } })
    const op = (long.paths as Record<string, Record<string, { parameters: Array<{ name: string; schema: { maximum?: number } }> }>>)['/availability'].get
    expect(op.parameters.find((p) => p.name === 'days')?.schema.maximum).toBe(31)
  })

  it('AC-12 the error schema lists suggested_times', () => {
    const error = (doc.components.schemas.Error as unknown) as { properties: Record<string, unknown> }
    expect(error.properties.suggested_times).toBeDefined()
  })

  it('AC-14 without terms, accept_terms is in the schema but not required, and no terms text is shown', () => {
    const schema = createSchema(doc)
    expect(schema.properties.accept_terms).toMatchObject({ type: 'boolean' })
    expect(schema.required).not.toContain('accept_terms')
    expect(text).not.toContain('Booking terms')
  })
})

describe('AC-13 terms set: the agent must show them first and send accept_terms', () => {
  const doc = buildAgentBookingOpenApi({ ...BASE, booking: { hours: { ...HOURS, terms: TERMS }, today: TODAY } })

  it('AC-13 both languages of the terms are in the description with the show-first rule', () => {
    expect(doc.info.description).toContain(TERMS.zh_hk)
    expect(doc.info.description).toContain(TERMS.en)
    expect(doc.info.description).toMatch(/show .*terms to the diner/i)
    expect(doc.info.description).toContain('terms_required')
  })

  it('AC-13 accept_terms is required', () => {
    expect(createSchema(doc).required).toContain('accept_terms')
  })
})

describe('AC-13 the post-confirm WhatsApp reply carries the terms', () => {
  it('AC-13 termsReplyText labels the stored text in both languages', () => {
    expect(termsReplyText('訂座保留 15 分鐘。\n\nTables are held for 15 minutes.')).toBe(
      '訂座須知 Booking terms:\n訂座保留 15 分鐘。\n\nTables are held for 15 minutes.'
    )
  })
})
