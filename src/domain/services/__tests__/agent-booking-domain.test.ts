// BOOK-003 domain rules: confirm codes (R31), agent booking config (R43),
// website host (spec 3.1), statuses (R36), the collection statement (R44).
import { describe, it, expect } from 'vitest'
import { randomInt } from 'node:crypto'
import {
  CONFIRM_CODE_ALPHABET,
  extractConfirmCodeCandidates,
  generateConfirmCode,
  isConfirmCode,
} from '../booking-confirm-code'
import { agentBookingStatus } from '../agent-booking'
import { buildAgentBookingOpenApi, buildCollectionStatement, buildConfirmText, collectionStatementText } from '../poppy-documents'
import {
  DEFAULT_BOOKING_CONFIG,
  normalizeWebsiteHost,
  parseAgentBookingSettings,
  resolveBookingConfig,
} from '@/domain/value-objects/booking-config'

describe('confirm code (R31)', () => {
  it('has no ambiguous characters (0, O, 1, I) in its alphabet', () => {
    for (const c of '0O1I') expect(CONFIRM_CODE_ALPHABET).not.toContain(c)
    expect(CONFIRM_CODE_ALPHABET).toHaveLength(32)
  })

  it('every generated code is 6 alphabet chars with a digit, over 2,000 draws', () => {
    const codes = Array.from({ length: 2000 }, () => generateConfirmCode((n) => randomInt(n)))
    for (const code of codes) {
      expect(code).toMatch(/^[2-9A-HJ-NP-Z]{6}$/)
      expect(code).toMatch(/[2-9]/)
      expect(isConfirmCode(code)).toBe(true)
    }
    expect(new Set(codes).size).toBeGreaterThan(1990)
  })

  it('redraws a letters-only code', () => {
    const script = [...'ABCDEF', ...'ABCDE2'].map((c) => CONFIRM_CODE_ALPHABET.indexOf(c))
    expect(generateConfirmCode(() => script.shift() as number)).toBe('ABCDE2')
  })

  it('finds the code in the prefilled text, lower-cased or bare; ignores words and ambiguous chars', () => {
    expect(extractConfirmCodeCandidates(buildConfirmText('Cafe A', 'K7PX3M'))).toEqual(['K7PX3M'])
    expect(extractConfirmCodeCandidates('k7px3m')).toEqual(['K7PX3M'])
    expect(extractConfirmCodeCandidates('確認訂座K7PX3M')).toEqual(['K7PX3M'])
    expect(extractConfirmCodeCandidates('THANKS PLEASE BOOKED')).toEqual([])
    expect(extractConfirmCodeCandidates('AB10CD K7PX3MX')).toEqual([])
    expect(extractConfirmCodeCandidates('A2BCDE A3BCDE A4BCDE A5BCDE')).toHaveLength(3)
  })

  it('F5: a restaurant name full of code-like words never pushes the real code out of the candidates', () => {
    // The brief's name has 2 code-shaped tokens (2NDFLR, B2CAFE): with the code that is exactly 3, so one
    // more (3RDFLR) is needed to overflow MAX_CODE_CANDIDATES.
    for (const name of ['K11 MUSEA 2NDFLR B2CAFE', 'K11 MUSEA 2NDFLR B2CAFE 3RDFLR']) {
      expect(extractConfirmCodeCandidates(buildConfirmText(name, 'K7PX3M'))).toContain('K7PX3M')
    }
    expect(extractConfirmCodeCandidates('A2BCDE A3BCDE A4BCDE A5BCDE')).toHaveLength(3)
  })
})

describe('agent booking config (R43)', () => {
  it('is off by default and a stored blob without it resolves to off', () => {
    expect(DEFAULT_BOOKING_CONFIG.agentBooking).toEqual({ enabled: false, publicId: null, websiteHost: null })
    expect(resolveBookingConfig({ mode: 'simple' }).agentBooking.enabled).toBe(false)
  })

  it('enabled without a well-formed public id resolves to off', () => {
    expect(resolveBookingConfig({ agentBooking: { enabled: true, publicId: 'short' } }).agentBooking.enabled).toBe(false)
    expect(resolveBookingConfig({ agentBooking: { enabled: true, publicId: 'P'.repeat(32) } }).agentBooking.enabled).toBe(true)
  })

  it('the first enable mints an id; a later save keeps it', () => {
    const current = { ...DEFAULT_BOOKING_CONFIG, mode: 'simple' as const }
    const first = parseAgentBookingSettings({ enabled: true, websiteHost: 'www.a.hk' }, current, () => 'N'.repeat(32))
    expect(first).toEqual({ ok: true, agentBooking: { enabled: true, publicId: 'N'.repeat(32), websiteHost: 'www.a.hk' } })
    const withId = { ...current, agentBooking: { enabled: true, publicId: 'O'.repeat(32), websiteHost: 'www.a.hk' } }
    const again = parseAgentBookingSettings({ enabled: true }, withId, () => 'Z'.repeat(32))
    expect(again.ok && again.agentBooking.publicId).toBe('O'.repeat(32))
  })
})

describe('website host = organization.domain (spec 3.1)', () => {
  it.each([
    ['www.cafe.hk', 'www.cafe.hk'],
    ['WWW.Cafe.HK', 'www.cafe.hk'],
    ['https://cafe.hk/', 'cafe.hk'],
    ['cafe.hk:8443', 'cafe.hk:8443'],
    ['cafe.hk:443', 'cafe.hk'],
    // F9: the port is rebuilt from its number, so leading zeros never leave a stray ':' or digit.
    ['www.x.hk:0443', 'www.x.hk'],
    ['https://www.x.hk:00443/', 'www.x.hk'],
    ['cafe.hk:08443', 'cafe.hk:8443'],
  ])('%s → %s', (raw, host) => expect(normalizeWebsiteHost(raw)).toBe(host))

  it.each(['http://cafe.hk', 'cafe.hk/path', 'cafe.hk?x=1', 'localhost', 'user@cafe.hk', 'cafe .hk', '-cafe.hk', 'cafe.hk:0', 'cafe.hk:00000', 'cafe.hk:65536', ''])(
    'rejects %s',
    (raw) => expect(normalizeWebsiteHost(raw)).toBeNull()
  )
})

describe('agent booking status (R36)', () => {
  const now = new Date('2026-11-19T02:10:00.000Z')
  it('unverified splits into awaiting and expired by the clock; others pass through', () => {
    expect(agentBookingStatus('unverified', '2026-11-19T02:30:00.000Z', now)).toBe('awaiting_confirmation')
    expect(agentBookingStatus('unverified', '2026-11-19T02:10:00.000Z', now)).toBe('expired')
    expect(agentBookingStatus('confirmed', null, now)).toBe('confirmed')
  })
})

describe('collection statement (R44)', () => {
  it('names the restaurant in both languages with the privacy link; the WhatsApp text carries all three', () => {
    const s = buildCollectionStatement('Cafe\nA', 'https://ohmyclient.io/privacy-policy.html')
    expect(s.en).toBe('The details you submit (date, time, party size, name, phone number and notes) go only to Cafe A, to handle this booking.')
    expect(s['zh-HK']).toContain('只會交給Cafe A,用作處理今次訂座')
    const text = collectionStatementText(s)
    expect(text).toContain(s.en)
    expect(text).toContain(s['zh-HK'])
    expect(text).toContain('https://ohmyclient.io/privacy-policy.html')
  })
})

describe('OpenAPI description (review F10)', () => {
  const doc = buildAgentBookingOpenApi({
    restaurantName: 'Cafe A',
    apiBaseUrl: 'https://app.ohmyclient.io/api/poppy/PID',
    maxPartySize: 20,
    statement: buildCollectionStatement('Cafe A', 'https://p.example/privacy'),
  })
  const create = doc.paths['/bookings'].post.responses as Record<string, { content?: Record<string, { schema: unknown }> }>
  const get = doc.paths['/bookings/{booking_id}'].get.responses as Record<string, { content?: Record<string, { schema: unknown }> }>

  it('documents the Idempotency-Key replay: 200 with the status view, a fresh status_token and the statement', () => {
    expect(create['200'].content?.['application/json'].schema).toEqual({ $ref: '#/components/schemas/ReplayedBooking' })
    const replayed = doc.components.schemas.ReplayedBooking
    expect(replayed.allOf[0]).toEqual({ $ref: '#/components/schemas/BookingStatus' })
    expect(JSON.stringify(replayed)).toContain('"status_token"')
    expect(JSON.stringify(replayed)).toContain('#/components/schemas/CollectionStatement')
  })

  it('documents 500 server_error on both operations', () => {
    for (const responses of [create, get]) {
      expect(responses['500'].content?.['application/json'].schema).toEqual({ $ref: '#/components/schemas/Error' })
    }
  })
})
