// BOOK-014 W1: the deposit repositories match migration 097 (memory:
// incident_int001_fakes_hid_schema_mismatch). Mocked clients accept any
// column or RPC argument; this test does not.
import path from 'node:path'
import fs from 'node:fs'
import { describe, it, expect } from 'vitest'
import { columnsForTable } from './schema-contract/parse-schema'
import { repositoryColumnsByTable } from './schema-contract/parse-repository-columns'
import { bookingInsertRow } from '../booking-request-repository'
import { depositInsertRow } from '../booking-deposit-repository'
import { money } from '@/domain/value-objects/money'

const REPOS_DIR = path.join(process.cwd(), 'src/infrastructure/supabase/repositories')
const MIGRATION = fs.readFileSync(path.join(process.cwd(), 'supabase/migrations/097_booking_deposits.sql'), 'utf8')
const read = (file: string) => fs.readFileSync(path.join(REPOS_DIR, file), 'utf8')

const CASES = [
  { table: 'booking_deposits', file: 'booking-deposit-repository.ts' },
  { table: 'merchant_payment_accounts', file: 'merchant-payment-account-repository.ts' },
]

const arrayIn = (name: string) =>
  (new RegExp(`${name} text\\[\\] := ARRAY\\[([^\\]]+)\\]`).exec(MIGRATION)?.[1].match(/'([a-z_]+)'/g) ?? []).map((c) => c.slice(1, -1))

describe('BOOK-014 schema contract: deposit repositories match migration 097', () => {
  for (const { table, file } of CASES) {
    it(`${file} only selects/writes columns that exist on ${table}`, () => {
      const schema = columnsForTable(table)
      const used = repositoryColumnsByTable(path.join(REPOS_DIR, file)).get(table) ?? new Set<string>()
      expect(used.size).toBeGreaterThan(0)
      expect([...used].filter((c) => !schema.has(c)).sort()).toEqual([])
    })

    it(`${file} filters only on columns of ${table}`, () => {
      const schema = columnsForTable(table)
      const filters = [...read(file).matchAll(/\.(?:eq|is|gt|lt|order)\(\s*'([a-z_]+)'/g)].map((m) => m[1])
      expect(filters.length).toBeGreaterThan(0)
      expect(filters.filter((c) => !schema.has(c))).toEqual([])
    })
  }

  it('insert_booking_request_if_room (097) allows exactly the shared booking row and the deposit row keys', () => {
    const row = bookingInsertRow({
      restaurantId: 'r', memberId: null, phone: '+85290000000', name: 'n', partySize: 2, bookingDate: '2026-12-24',
      bookingTime: '19:00', notes: null, source: 'chat', campaignId: null, token: null, replacesBookingId: 'b',
      termsAcceptedAt: '2026-11-20T00:00:00Z', termsText: 't',
    })
    expect(arrayIn('v_allowed').sort()).toEqual(Object.keys(row).sort())
    const dep = depositInsertRow({
      id: 'd', providerCode: 'test', accountId: 'a', providerAccountId: 'acct', amount: money(1, 'HKD'), holdExpiresAt: 'x', linkTokenHash: 'h',
    })
    expect(arrayIn('v_deposit_keys').sort()).toEqual(Object.keys(dep).sort())
    const deposits = columnsForTable('booking_deposits')
    expect(Object.keys(dep).filter((c) => !deposits.has(c))).toEqual([])
  })

  it('every RPC the deposit repository calls exists in 097 with every argument name it passes', () => {
    const source = read('booking-deposit-repository.ts')
    const calls = [...source.matchAll(/rpc(?:Deposits)?\(\s*'([a-z_]+)',\s*\{([^}]*)\}/g)]
    expect(calls.length).toBeGreaterThanOrEqual(8)
    for (const [, fn, body] of calls) {
      const signature = new RegExp(`FUNCTION public\\.${fn}\\(([\\s\\S]*?)\\) RETURNS`).exec(MIGRATION)?.[1]
      expect(signature, fn).toBeDefined()
      for (const arg of [...body.matchAll(/(p_[a-z_]+)\s*:/g)].map((m) => m[1])) expect(signature, `${fn}.${arg}`).toContain(arg)
    }
  })

  it('097 adds the two booking statuses to both CHECKs', () => {
    expect(MIGRATION).toMatch(/booking_requests_status_check\s+CHECK \(status IN \([^)]*'awaiting_deposit', 'lapsed'\)\)/)
    expect(MIGRATION).toMatch(/status IN \('unverified', 'pending', 'awaiting_deposit', 'lapsed'\) AND decided_at IS NULL/)
  })
})
