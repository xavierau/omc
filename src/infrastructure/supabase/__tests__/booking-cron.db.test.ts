/**
 * DB INTEGRATION TESTS for the BOOK-001 W3 cron SQL (AC-15, R19).
 *
 * The reminder claim must win once under two overlapping cron runs, and the
 * retention purge must clear only name/notes on rows past the cutoff, once.
 * Both are properties of the SQL, so they run against real Postgres. Same
 * harness and gating as booking.db.test.ts:
 *
 *   RUN_DB_TESTS=1 PGPORT=5432 PGDATABASE=scratch_book001 \
 *     npx vitest run src/infrastructure/supabase/__tests__/booking-cron.db.test.ts
 *
 * The SQL mirrors booking-request-repository.ts claimBookingReminder and
 * purgeBookingPii.
 */
import { execFile, execFileSync } from 'node:child_process'
import { promisify } from 'node:util'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

const RUN = process.env.RUN_DB_TESTS === '1'
const d = RUN ? describe : describe.skip
const execFileAsync = promisify(execFile)

const PG = {
  host: process.env.PGHOST ?? '127.0.0.1',
  port: process.env.PGPORT ?? '54322',
  user: process.env.PGUSER ?? process.env.USER ?? 'postgres',
  password: process.env.PGPASSWORD ?? 'postgres',
  database: process.env.PGDATABASE ?? 'scratch_book001',
}

const args = (sql: string) => ['-h', PG.host, '-p', PG.port, '-U', PG.user, '-d', PG.database, '-v', 'ON_ERROR_STOP=1', '-qtAc', sql]
const env = () => ({ ...process.env, PGPASSWORD: PG.password })
const psql = (sql: string) => execFileSync('psql', args(sql), { env: env(), encoding: 'utf8' }).trim()
const psqlAsync = async (sql: string) => (await execFileAsync('psql', args(sql), { env: env(), encoding: 'utf8' })).stdout.trim()

const R = 'c0000000-0000-4000-8000-00000000000a'
const REMIND = 'c0000000-0000-4000-8000-0000000000a1'
const OLD = 'c0000000-0000-4000-8000-0000000000b1'
const NEW = 'c0000000-0000-4000-8000-0000000000b2'

const claim = (id: string) =>
  `UPDATE booking_requests SET reminder_sent_at = now()
     WHERE id = '${id}' AND status = 'confirmed' AND reminder_sent_at IS NULL RETURNING id`

const purge = (cutoff: string) =>
  `UPDATE booking_requests SET name = NULL, notes = NULL, pii_purged_at = now()
     WHERE booking_date < '${cutoff}' AND pii_purged_at IS NULL RETURNING id`

const confirmed = (id: string, date: string) =>
  `INSERT INTO booking_requests (id, restaurant_id, phone, name, party_size, booking_date, booking_time, notes, source, status, decided_at)
   VALUES ('${id}', '${R}', '+85291110000', 'Chan', 4, '${date}', '19:30', 'window seat', 'chat', 'confirmed', now())`

d('BOOK-001 W3 cron SQL (real Postgres)', () => {
  beforeAll(() => {
    psql(`DELETE FROM restaurants WHERE id = '${R}'`)
    psql(`INSERT INTO restaurants (id, name, slug, whatsapp_number) VALUES ('${R}', 'Rest C', 'book-cron', '+85220000009')`)
    psql(confirmed(REMIND, '2026-11-20'))
    psql(confirmed(OLD, '2026-05-15'))
    psql(confirmed(NEW, '2026-05-16'))
  })

  afterAll(() => psql(`DELETE FROM restaurants WHERE id = '${R}'`))

  it('lets exactly one of two concurrent reminder claims win (AC-15)', async () => {
    const results = await Promise.all([psqlAsync(claim(REMIND)), psqlAsync(claim(REMIND))])
    expect(results.filter((r) => r.length > 0)).toHaveLength(1)
    expect(psql(claim(REMIND))).toBe('')
  })

  it('never claims a pending booking', () => {
    const id = 'c0000000-0000-4000-8000-0000000000a2'
    psql(`INSERT INTO booking_requests (id, restaurant_id, phone, name, party_size, booking_date, booking_time, source)
          VALUES ('${id}', '${R}', '+85291110000', 'Lee', 2, '2026-11-20', '12:00', 'chat')`)
    expect(psql(claim(id))).toBe('')
  })

  it('purges name and notes before the cutoff only, keeps the rest, and is idempotent (R19)', () => {
    expect(psql(purge('2026-05-16'))).toBe(OLD)
    expect(psql(`SELECT name IS NULL, notes IS NULL, pii_purged_at IS NOT NULL, status, party_size, booking_date, phone
                 FROM booking_requests WHERE id = '${OLD}'`)).toBe('t|t|t|confirmed|4|2026-05-15|+85291110000')
    expect(psql(`SELECT name, notes, pii_purged_at IS NULL FROM booking_requests WHERE id = '${NEW}'`)).toBe('Chan|window seat|t')
    expect(psql(purge('2026-05-16'))).toBe('')
  })
})
