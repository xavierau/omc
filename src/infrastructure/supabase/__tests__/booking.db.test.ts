/**
 * DB INTEGRATION TESTS for migration 082 (BOOK-001 W1-01, R1, R4).
 *
 * Unit tests drive fakes, so they can only prove what the CALLER does. That a
 * personal booking link is single-use under a real race, that a decision
 * flips status exactly once, and that the CHECKs hold are properties of the
 * SQL, so they run against a real Postgres here.
 *
 * Gated behind `RUN_DB_TESTS=1` like recipient-rpcs.db.test.ts, and talks to
 * Postgres through `psql` (no `pg` driver in the repo). `PGDATABASE` must name
 * a scratch database with migrations 001..082 applied; it defaults to
 * `scratch_book001`, built from this tree's migrations with Supabase stubs
 * (auth/storage/extensions/realtime), then dropped. The build is recorded in
 * .claude-workspace/artifacts/2026-11-12-book-001-w1-handoff.md.
 *
 *   RUN_DB_TESTS=1 PGPORT=5432 PGDATABASE=scratch_book001 \
 *     npx vitest run src/infrastructure/supabase/__tests__/booking.db.test.ts
 *
 * The SQL below mirrors what the repositories send through PostgREST:
 * booking-token-repository.ts `consumeBookingToken` and
 * booking-request-repository.ts `decideBookingRequest`.
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

function args(sql: string): string[] {
  return ['-h', PG.host, '-p', PG.port, '-U', PG.user, '-d', PG.database, '-v', 'ON_ERROR_STOP=1', '-qtAc', sql]
}

const env = () => ({ ...process.env, PGPASSWORD: PG.password })

function psql(sql: string): string {
  return execFileSync('psql', args(sql), { env: env(), encoding: 'utf8' }).trim()
}

async function psqlAsync(sql: string): Promise<string> {
  const { stdout } = await execFileAsync('psql', args(sql), { env: env(), encoding: 'utf8' })
  return stdout.trim()
}

function fails(sql: string): boolean {
  try {
    execFileSync('psql', args(sql), { env: env(), encoding: 'utf8', stdio: 'pipe' })
    return false
  } catch {
    return true
  }
}

const A = 'b0000000-0000-4000-8000-00000000000a'
const B = 'b0000000-0000-4000-8000-00000000000b'
const CAMPAIGN = 'b0000000-0000-4000-8000-0000000000c1'
const MEMBER = 'b0000000-0000-4000-8000-0000000000e1'
const TOKEN_LIVE = 'L'.repeat(43)
const TOKEN_FOREVER = 'F'.repeat(43)
const TOKEN_EXPIRED = 'X'.repeat(43)
const TOKEN_RACE = 'R'.repeat(43)

// The exact predicate consumeBookingToken sends (R1).
const claim = (token: string) =>
  `UPDATE booking_tokens SET consumed_at = now()
     WHERE token = '${token}' AND consumed_at IS NULL
       AND (expires_at IS NULL OR expires_at > now())
     RETURNING restaurant_id, phone`

function cleanup() {
  psql(`DELETE FROM restaurants WHERE id IN ('${A}', '${B}')`)
}

d('migration 082 booking schema (real Postgres)', () => {
  beforeAll(() => {
    cleanup()
    psql(`INSERT INTO restaurants (id, name, slug, whatsapp_number) VALUES
            ('${A}', 'Rest A', 'book-a', '+85220000001'),
            ('${B}', 'Rest B', 'book-b', '+85220000002')`)
    psql(`INSERT INTO members (id, restaurant_id, phone) VALUES ('${MEMBER}', '${A}', '+85291110000')`)
    psql(`INSERT INTO campaigns (id, restaurant_id, type, template) VALUES ('${CAMPAIGN}', '${A}', 'promo', 'x')`)
    psql(`INSERT INTO booking_tokens (token, restaurant_id, phone, source, campaign_id, expires_at) VALUES
            ('${TOKEN_LIVE}', '${A}', '+85291110000', 'chat', NULL, now() + interval '1 day'),
            ('${TOKEN_FOREVER}', '${A}', '+85291110000', 'campaign', '${CAMPAIGN}', NULL),
            ('${TOKEN_EXPIRED}', '${A}', '+85291110000', 'chat', NULL, now() - interval '1 minute'),
            ('${TOKEN_RACE}', '${A}', '+85291110000', 'chat', NULL, NULL)`)
  })

  afterAll(() => cleanup())

  it('defaults restaurants.booking_config to mode off and rejects an unknown mode', () => {
    expect(psql(`SELECT booking_config->>'mode' FROM restaurants WHERE id = '${A}'`)).toBe('off')
    expect(fails(`UPDATE restaurants SET booking_config = '{"mode":"bogus"}' WHERE id = '${A}'`)).toBe(true)
    psql(`UPDATE restaurants SET booking_config = '{"mode":"simple","chatLinkTtlHours":null}' WHERE id = '${A}'`)
    expect(psql(`SELECT booking_config->>'mode' FROM restaurants WHERE id = '${A}'`)).toBe('simple')
  })

  it('stores campaigns.book_now_enabled (default false) and only an https booking_url', () => {
    expect(psql(`SELECT book_now_enabled FROM campaigns WHERE id = '${CAMPAIGN}'`)).toBe('f')
    psql(`UPDATE campaigns SET book_now_enabled = true, booking_url = 'https://inline.app/x' WHERE id = '${CAMPAIGN}'`)
    expect(psql(`SELECT booking_url FROM campaigns WHERE id = '${CAMPAIGN}'`)).toBe('https://inline.app/x')
    expect(fails(`UPDATE campaigns SET booking_url = 'http://inline.app/x' WHERE id = '${CAMPAIGN}'`)).toBe(true)
    expect(fails(`UPDATE campaigns SET booking_url = 'javascript:alert(1)' WHERE id = '${CAMPAIGN}'`)).toBe(true)
  })

  it('claims a live token once, a no-expiry token once, and never an expired one (R1)', () => {
    expect(psql(claim(TOKEN_LIVE))).toBe(`${A}|+85291110000`)
    expect(psql(claim(TOKEN_LIVE))).toBe('')
    expect(psql(claim(TOKEN_FOREVER))).toBe(`${A}|+85291110000`)
    expect(psql(claim(TOKEN_FOREVER))).toBe('')
    expect(psql(claim(TOKEN_EXPIRED))).toBe('')
  })

  it('lets exactly one of two concurrent claims win the same token (R1)', async () => {
    const results = await Promise.all([psqlAsync(claim(TOKEN_RACE)), psqlAsync(claim(TOKEN_RACE))])
    expect(results.filter((r) => r.length > 0)).toHaveLength(1)
  })

  it('stores and reads a booking request, and allows one booking per token', () => {
    psql(`INSERT INTO booking_requests
            (id, restaurant_id, member_id, phone, name, party_size, booking_date, booking_time, notes, source, campaign_id, token)
          VALUES ('b0000000-0000-4000-8000-0000000000d1', '${A}', '${MEMBER}', '+85291110000', 'Chan', 4,
                  current_date + 1, '19:30', 'window seat', 'campaign', '${CAMPAIGN}', '${TOKEN_FOREVER}')`)
    expect(
      psql(`SELECT status, party_size, booking_time, member_id FROM booking_requests WHERE token = '${TOKEN_FOREVER}'`)
    ).toBe(`pending|4|19:30:00|${MEMBER}`)
    expect(
      fails(`INSERT INTO booking_requests (restaurant_id, phone, name, party_size, booking_date, booking_time, source, token)
             VALUES ('${A}', '+85291110000', 'Again', 2, current_date + 1, '19:00', 'chat', '${TOKEN_FOREVER}')`)
    ).toBe(true)
  })

  it('rejects out-of-range values and an inconsistent decision', () => {
    const base = `INSERT INTO booking_requests (restaurant_id, phone, name, party_size, booking_date, booking_time, source`
    expect(fails(`${base}) VALUES ('${A}', '+1', 'x', 0, current_date, '10:00', 'chat')`)).toBe(true)
    expect(fails(`${base}) VALUES ('${A}', '+1', '${'n'.repeat(61)}', 2, current_date, '10:00', 'chat')`)).toBe(true)
    expect(fails(`${base}, notes) VALUES ('${A}', '+1', 'x', 2, current_date, '10:00', 'chat', '${'n'.repeat(501)}')`)).toBe(true)
    expect(fails(`${base}, status) VALUES ('${A}', '+1', 'x', 2, current_date, '10:00', 'chat', 'confirmed')`)).toBe(true)
  })

  it('flips pending to confirmed exactly once under two concurrent decisions, scoped by tenant (R4, R6)', async () => {
    const id = 'b0000000-0000-4000-8000-0000000000d2'
    psql(`INSERT INTO booking_requests (id, restaurant_id, phone, name, party_size, booking_date, booking_time, source)
          VALUES ('${id}', '${A}', '+85291110000', 'Lee', 2, current_date + 2, '12:00', 'chat')`)
    const decide = (tenant: string) =>
      `UPDATE booking_requests SET status = 'confirmed', decided_by = gen_random_uuid(), decided_at = now()
         WHERE id = '${id}' AND restaurant_id = '${tenant}' AND status = 'pending' RETURNING id`
    expect(psql(decide(B))).toBe('')
    const results = await Promise.all([psqlAsync(decide(A)), psqlAsync(decide(A))])
    expect(results.filter((r) => r.length > 0)).toHaveLength(1)
    expect(psql(`SELECT status, decided_at IS NOT NULL FROM booking_requests WHERE id = '${id}'`)).toBe('confirmed|t')
  })

  it('records a classification without any text column (R17)', () => {
    psql(`INSERT INTO inbound_classifications (restaurant_id, message_id, label, confidence, outcome)
          VALUES ('${A}', 'wamid.1', 'booking', 0.91, 'booking_reply'),
                 ('${A}', 'wamid.2', NULL, NULL, 'error')`)
    expect(psql(`SELECT count(*) FROM inbound_classifications WHERE restaurant_id = '${A}'`)).toBe('2')
    expect(
      fails(`INSERT INTO inbound_classifications (restaurant_id, message_id, outcome) VALUES ('${A}', 'wamid.1', 'fallback')`)
    ).toBe(true)
    const columns = psql(
      `SELECT string_agg(column_name, ',' ORDER BY column_name) FROM information_schema.columns WHERE table_name = 'inbound_classifications'`
    )
    expect(columns).toBe('confidence,created_at,id,label,message_id,outcome,restaurant_id')
  })

  it('enables RLS with no policies on every new table', () => {
    for (const table of ['booking_tokens', 'booking_requests', 'inbound_classifications']) {
      expect(psql(`SELECT relrowsecurity FROM pg_class WHERE relname = '${table}'`)).toBe('t')
      expect(psql(`SELECT count(*) FROM pg_policies WHERE tablename = '${table}'`)).toBe('0')
    }
  })
})
