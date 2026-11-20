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
 * purgeBookingPii; listReminderCandidates calls booking_reminder_candidates
 * (082) as is (F7).
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

  // F7 (review #5, S-4): due = start in (now, now + 3h], booked >= 3h before
  // the start, confirmed, not reminded; ordered by date then time.
  describe('booking_reminder_candidates', () => {
    const W = 'c0000000-0000-4000-8000-000000000'
    const NOW = '2026-11-25T09:00:00Z' // 17:00 HKT on the 25th
    const row = (n: number, date: string, time: string, created: string) =>
      `INSERT INTO booking_requests (id, restaurant_id, phone, name, party_size, booking_date, booking_time, source, status, decided_at, created_at)
       VALUES ('${W}${n.toString(16).padStart(3, '0')}', '${R}', '+85291110000', 'W', 2, '${date}', '${time}', 'chat', 'confirmed', now(), '${created}')`
    const due = (limit: number) =>
      psql(`SELECT string_agg(id::text, ',' ORDER BY ord) FROM (
              SELECT id, row_number() OVER () AS ord
              FROM booking_reminder_candidates('${NOW}'::timestamptz, 3, ${limit})) s`)
    const id = (n: number) => `${W}${n.toString(16).padStart(3, '0')}`

    beforeAll(() => {
      psql(row(1, '2026-11-25', '19:30', '2026-11-20T00:00:00Z')) // due
      psql(row(2, '2026-11-25', '18:00', '2026-11-20T00:00:00Z')) // due, earlier start
      psql(row(3, '2026-11-25', '20:01', '2026-11-20T00:00:00Z')) // window not open (starts > now + 3h)
      psql(row(4, '2026-11-25', '17:00', '2026-11-20T00:00:00Z')) // starts now: already started
      psql(row(5, '2026-11-25', '19:00', '2026-11-25T08:30:00Z')) // booked 2.5h ahead: never due
      psql(row(6, '2026-11-25', '20:00', '2026-11-25T09:00:00Z')) // booked exactly 3h ahead, starts at now + 3h: due
      for (let n = 16; n < 40; n++) psql(row(n, '2026-11-25', '17:30', '2026-11-25T09:00:00Z')) // flood: booked late, earliest start
    })

    it('returns only due bookings, earliest start first, past a flood of never-due rows', () => {
      expect(due(10)).toBe([id(2), id(1), id(6)].join(','))
      expect(due(1)).toBe(id(2))
    })

    it('a window crossing midnight HKT finds the next-day booking', () => {
      psql(row(7, '2026-11-26', '01:00', '2026-11-20T00:00:00Z'))
      expect(psql(`SELECT count(*) FROM booking_reminder_candidates('2026-11-25T15:30:00Z'::timestamptz, 3, 10) WHERE id = '${id(7)}'`)).toBe('1')
    })

    it('skips reminded and non-confirmed bookings, and is service-role only', () => {
      psql(`UPDATE booking_requests SET reminder_sent_at = now() WHERE id = '${id(2)}'`)
      expect(due(10)).toBe([id(1), id(6)].join(','))
      const grants = psql(`SELECT string_agg(grantee, ',' ORDER BY grantee) FROM information_schema.role_routine_grants
                           WHERE routine_name = 'booking_reminder_candidates' AND privilege_type = 'EXECUTE'`)
      expect(grants.split(',')).toContain('service_role')
      expect(grants.split(',')).not.toContain('anon')
      expect(grants.split(',')).not.toContain('authenticated')
      expect(grants.split(',')).not.toContain('PUBLIC')
    })
  })

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
