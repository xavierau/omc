// BOOK-001 W1-01: every column a booking repository selects, inserts or
// updates exists on its table in the migrations SQL (memory:
// incident_int001_fakes_hid_schema_mismatch). Mocked clients accept any
// column string; this test does not.
import path from 'node:path'
import fs from 'node:fs'
import { describe, it, expect } from 'vitest'
import { columnsForTable } from './schema-contract/parse-schema'
import { repositoryColumnsByTable } from './schema-contract/parse-repository-columns'
import { bookingInsertRow } from '../booking-request-repository'

const REPOS_DIR = path.join(process.cwd(), 'src/infrastructure/supabase/repositories')

const CASES = [
  { table: 'booking_tokens', file: 'booking-token-repository.ts' },
  { table: 'booking_requests', file: 'booking-request-repository.ts' },
  { table: 'restaurants', file: 'booking-config-repository.ts' },
  { table: 'campaigns', file: 'booking-config-repository.ts' },
  { table: 'inbound_classifications', file: 'inbound-classification-repository.ts' },
  // BOOK-003 (084): agent bookings.
  { table: 'booking_requests', file: 'agent-booking-repository.ts' },
  // BOOK-010 (092): staff stops.
  { table: 'booking_stops', file: 'booking-room-repository.ts' },
]

/** Columns used in WHERE/ORDER clauses too (`.eq('col'`, `.is('col'`, ...). */
function filterColumns(file: string): string[] {
  const source = fs.readFileSync(path.join(REPOS_DIR, file), 'utf8')
  return [...source.matchAll(/\.(?:eq|is|gt|lt|order)\(\s*'([a-z_]+)'/g)].map((m) => m[1])
}

describe('BOOK-001 schema contract: booking repositories match migration 082', () => {
  for (const { table, file } of CASES) {
    it(`${file} only selects/writes columns that exist on ${table}`, () => {
      const schema = columnsForTable(table)
      const used = repositoryColumnsByTable(path.join(REPOS_DIR, file)).get(table) ?? new Set<string>()
      expect(used.size).toBeGreaterThan(0)
      expect([...used].filter((c) => !schema.has(c)).sort()).toEqual([])
    })
  }

  it('filter columns exist on the tables they filter', () => {
    const tokens = columnsForTable('booking_tokens')
    const requests = columnsForTable('booking_requests')
    for (const c of filterColumns('booking-token-repository.ts')) expect(tokens.has(c), c).toBe(true)
    for (const c of filterColumns('booking-request-repository.ts')) expect(requests.has(c), c).toBe(true)
    for (const c of filterColumns('agent-booking-repository.ts')) expect(requests.has(c), c).toBe(true)
    const stops = columnsForTable('booking_stops')
    for (const c of filterColumns('booking-room-repository.ts')) expect(stops.has(c), c).toBe(true)
    // BOOK-012 r2: the duplicate lookup filters inbound_classifications.
    const classifications = columnsForTable('inbound_classifications')
    for (const c of filterColumns('inbound-classification-repository.ts')) expect(classifications.has(c), c).toBe(true)
  })

  it('BOOK-010: every column the shared insert row writes exists (plain insert and insert_booking_request_if_room)', () => {
    const requests = columnsForTable('booking_requests')
    const row = bookingInsertRow({
      restaurantId: 'r', memberId: null, phone: '+85290000000', name: 'n', partySize: 2, bookingDate: '2026-11-21',
      bookingTime: '19:00', notes: null, source: 'agent', campaignId: null, token: null, replacesBookingId: 'b',
      termsAcceptedAt: '2026-11-20T00:00:00Z', termsText: 't',
    })
    expect(Object.keys(row).filter((c) => !requests.has(c))).toEqual([])
    expect(Object.keys(row)).toContain('terms_text')
  })

  it('BOOK-010: the 092 function allows exactly the shared insert row columns', () => {
    const sql = fs.readFileSync(path.join(process.cwd(), 'supabase/migrations/092_booking_guest_limits.sql'), 'utf8')
    const allowed = /v_allowed text\[\] := ARRAY\[([^\]]+)\]/.exec(sql)?.[1].match(/'([a-z_]+)'/g)?.map((c) => c.slice(1, -1)) ?? []
    const row = bookingInsertRow({
      restaurantId: 'r', memberId: null, phone: '+85290000000', name: 'n', partySize: 2, bookingDate: '2026-11-21',
      bookingTime: '19:00', notes: null, source: 'agent', campaignId: null, token: null, replacesBookingId: 'b',
      termsAcceptedAt: '2026-11-20T00:00:00Z', termsText: 't',
    })
    expect([...allowed].sort()).toEqual(Object.keys(row).sort())
  })

  it('084 adds the agent booking columns (R31, R35, R36, R46)', () => {
    const requests = columnsForTable('booking_requests')
    for (const c of ['confirm_code', 'verify_expires_at', 'verified_at', 'verified_wamid', 'status_token_hash', 'idempotency_key']) {
      expect(requests.has(c), c).toBe(true)
    }
  })

  it('082 adds the campaign and restaurant columns W2/W3 rely on', () => {
    expect(columnsForTable('restaurants').has('booking_config')).toBe(true)
    expect(columnsForTable('campaigns').has('book_now_enabled')).toBe(true)
    expect(columnsForTable('campaigns').has('booking_url')).toBe(true)
    expect([...columnsForTable('inbound_classifications')].sort()).toEqual(
      ['confidence', 'created_at', 'id', 'label', 'message_id', 'outcome', 'restaurant_id']
    )
  })
})
