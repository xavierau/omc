/**
 * DB INTEGRATION TESTS for migration 084 (BOOK-003, R31, R32, R39, R41, R43, R46).
 *
 * The SQL below mirrors what agent-booking-repository.ts and
 * booking-request-repository.ts send through PostgREST. Gated behind
 * `RUN_DB_TESTS=1`; `PGDATABASE` names a scratch database with migrations
 * 001..082 + 084 applied (Supabase stubs for auth/storage/extensions/realtime), built
 * as recorded in .claude-workspace/artifacts/2026-11-19-book-003-agent-booking-impl.md.
 *
 *   RUN_DB_TESTS=1 PGPORT=5432 PGDATABASE=scratch_book003 \
 *     npx vitest run src/infrastructure/supabase/__tests__/agent-booking.db.test.ts
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
  database: process.env.PGDATABASE ?? 'scratch_book003',
}

const args = (sql: string) => ['-h', PG.host, '-p', PG.port, '-U', PG.user, '-d', PG.database, '-v', 'ON_ERROR_STOP=1', '-qtAc', sql]
const env = () => ({ ...process.env, PGPASSWORD: PG.password })
const psql = (sql: string) => execFileSync('psql', args(sql), { env: env(), encoding: 'utf8' }).trim()
const psqlAsync = async (sql: string) => (await execFileAsync('psql', args(sql), { env: env(), encoding: 'utf8' })).stdout.trim()
function fails(sql: string): boolean {
  try {
    execFileSync('psql', args(sql), { env: env(), encoding: 'utf8', stdio: 'pipe' })
    return false
  } catch {
    return true
  }
}

const A = 'a3000000-0000-4000-8000-00000000000a'
const B = 'a3000000-0000-4000-8000-00000000000b'
const PHONE = '+85291234567'
const OTHER = '+85298765432'
const HASH = 'a'.repeat(64)

function insertAgent(opts: { id: string; code: string; restaurant?: string; phone?: string; expires?: string; created?: string; key?: string }) {
  const key = opts.key ? `'${opts.key}'` : 'NULL'
  return `INSERT INTO booking_requests
      (id, restaurant_id, phone, name, party_size, booking_date, booking_time, status, source, token, confirm_code,
       verify_expires_at, status_token_hash, idempotency_key, created_at)
    VALUES ('${opts.id}', '${opts.restaurant ?? A}', '${opts.phone ?? PHONE}', 'Chan', 4, current_date + 1, '19:30',
       'unverified', 'agent', NULL, '${opts.code}', ${opts.expires ?? "now() + interval '30 minutes'"}, '${HASH}', ${key},
       ${opts.created ?? 'now()'})`
}

// agent-booking-repository.ts promoteAgentBooking: the RPC with MAX_PENDING_PER_PHONE (3).
const promote = (phone: string, code: string, wamid: string, restaurant = A, codes: string[] = [code]) =>
  `SELECT id FROM promote_agent_booking('${restaurant}', '${phone}', ARRAY[${codes.map((c) => `'${c}'`).join(',')}]::text[],
     '${wamid}', now(), 3) ORDER BY id`

// A BOOK-001 chat booking already waiting for the restaurant.
const insertPending = (id: string, phone: string, restaurant = A) =>
  `INSERT INTO booking_requests (id, restaurant_id, phone, name, party_size, booking_date, booking_time, status, source, token)
     VALUES ('${id}', '${restaurant}', '${phone}', 'Chan', 2, current_date + 1, '19:00', 'pending', 'chat', NULL)`

// booking-request-repository.ts listBookingRequests (both reads) and decideBookingRequest.
const staffList = (restaurant = A) =>
  `SELECT id FROM booking_requests WHERE restaurant_id = '${restaurant}' AND status = 'pending'
   UNION ALL
   SELECT id FROM booking_requests WHERE restaurant_id = '${restaurant}' AND status IN ('confirmed', 'declined')`
const decide = (id: string) =>
  `UPDATE booking_requests SET status = 'confirmed', decided_by = gen_random_uuid(), decided_at = now()
     WHERE id = '${id}' AND restaurant_id = '${A}' AND status = 'pending' RETURNING id`
const staffFind = (id: string) => `SELECT id FROM booking_requests WHERE id = '${id}' AND restaurant_id = '${A}' AND status <> 'unverified'`

const cleanup = () => psql(`DELETE FROM restaurants WHERE id IN ('${A}', '${B}')`)

d('migration 084 agent booking schema (real Postgres)', () => {
  beforeAll(() => {
    cleanup()
    psql(`INSERT INTO restaurants (id, name, slug, whatsapp_number) VALUES
            ('${A}', 'Rest A', 'agent-a', '+85220000011'), ('${B}', 'Rest B', 'agent-b', '+85220000012')`)
  })
  afterAll(() => cleanup())

  it('accepts status unverified + source agent, keeps decided_at consistent, requires code and expiry', () => {
    psql(insertAgent({ id: 'a3000000-0000-4000-8000-0000000000d1', code: 'K7PX3M' }))
    expect(psql(`SELECT status, source, decided_at IS NULL FROM booking_requests WHERE id = 'a3000000-0000-4000-8000-0000000000d1'`))
      .toBe('unverified|agent|t')
    expect(fails(`UPDATE booking_requests SET decided_at = now() WHERE id = 'a3000000-0000-4000-8000-0000000000d1'`)).toBe(true)
    expect(fails(`UPDATE booking_requests SET confirm_code = NULL WHERE id = 'a3000000-0000-4000-8000-0000000000d1'`)).toBe(true)
    expect(fails(`UPDATE booking_requests SET source = 'robot' WHERE id = 'a3000000-0000-4000-8000-0000000000d1'`)).toBe(true)
    expect(fails(insertAgent({ id: 'a3000000-0000-4000-8000-0000000000d9', code: 'K0PX3M' }))).toBe(true)
  })

  it('R31: a code is unique among the restaurant\'s unverified bookings only', () => {
    expect(fails(insertAgent({ id: 'a3000000-0000-4000-8000-0000000000d2', code: 'K7PX3M', phone: OTHER }))).toBe(true)
    psql(insertAgent({ id: 'a3000000-0000-4000-8000-0000000000d3', code: 'K7PX3M', restaurant: B, phone: OTHER }))
  })

  it('R31/R41: unverified is invisible to the staff list, lookup and decision', () => {
    const id = 'a3000000-0000-4000-8000-0000000000d1'
    expect(psql(staffList())).not.toContain(id)
    expect(psql(staffFind(id))).toBe('')
    expect(psql(decide(id))).toBe('')
  })

  it('R31: the code from another phone, another restaurant or past expiry promotes nothing', () => {
    psql(insertAgent({ id: 'a3000000-0000-4000-8000-0000000000d4', code: 'Q2W3E4', expires: "now() - interval '1 second'" }))
    expect(psql(promote(OTHER, 'K7PX3M', 'wamid.x'))).toBe('')
    expect(psql(promote(PHONE, 'K7PX3M', 'wamid.x', B))).toBe('')
    expect(psql(promote(PHONE, 'Q2W3E4', 'wamid.x'))).toBe('')
    expect(psql(`SELECT count(*) FROM booking_requests WHERE restaurant_id = '${A}' AND status = 'unverified'`)).toBe('2')
  })

  it('R32: two concurrent deliveries of the same message promote once; a replay promotes nothing', async () => {
    const results = await Promise.all([psqlAsync(promote(PHONE, 'K7PX3M', 'wamid.1')), psqlAsync(promote(PHONE, 'K7PX3M', 'wamid.1'))])
    expect(results.filter((r) => r.length > 0)).toEqual(['a3000000-0000-4000-8000-0000000000d1'])
    expect(psql(promote(PHONE, 'K7PX3M', 'wamid.1'))).toBe('')
    expect(psql(`SELECT status, confirm_code IS NULL, verified_wamid, verified_at IS NOT NULL FROM booking_requests
                 WHERE id = 'a3000000-0000-4000-8000-0000000000d1'`)).toBe('pending|t|wamid.1|t')
  })

  it('AC-5: once promoted it is listed, decidable once, and the reminder RPC sees it only when confirmed', () => {
    const id = 'a3000000-0000-4000-8000-0000000000d1'
    expect(psql(staffList())).toContain(id)
    expect(psql(decide(id))).toBe(id)
    expect(psql(decide(id))).toBe('')
    expect(psql(`SELECT status FROM booking_requests WHERE id = '${id}'`)).toBe('confirmed')
    psql(insertAgent({ id: 'a3000000-0000-4000-8000-0000000000d5', code: 'Z9Y8X7', created: "now() - interval '1 day'" }))
    const reminders = psql(`SELECT id FROM booking_reminder_candidates(now() + interval '2 days', 72, 100)`)
    expect(reminders).not.toContain('a3000000-0000-4000-8000-0000000000d5')
  })

  it('R46: one row per idempotency key per restaurant', () => {
    psql(insertAgent({ id: 'a3000000-0000-4000-8000-0000000000d6', code: 'M3N4P5', key: 'key-1' }))
    expect(fails(insertAgent({ id: 'a3000000-0000-4000-8000-0000000000d7', code: 'M3N4P6', key: 'key-1' }))).toBe(true)
    psql(insertAgent({ id: 'a3000000-0000-4000-8000-0000000000d8', code: 'M3N4P7', key: 'key-1', restaurant: B }))
  })

  it('R41: the purge deletes unverified rows older than an hour and nothing else', () => {
    psql(`UPDATE booking_requests SET created_at = now() - interval '2 hours' WHERE id = 'a3000000-0000-4000-8000-0000000000d1'`)
    psql(insertAgent({ id: 'a3000000-0000-4000-8000-0000000000da', code: 'R2S3T4', created: "now() - interval '61 minutes'" }))
    const deleted = psql(`DELETE FROM booking_requests WHERE status = 'unverified' AND created_at < now() - interval '1 hour' RETURNING id`)
    expect(deleted.split('\n').sort()).toEqual(['a3000000-0000-4000-8000-0000000000d5', 'a3000000-0000-4000-8000-0000000000da'])
    expect(psql(`SELECT status FROM booking_requests WHERE id = 'a3000000-0000-4000-8000-0000000000d1'`)).toBe('confirmed')
  })

  it('F1 (BOOK-001 R11): a phone with three pending here cannot promote; another restaurant\'s pending do not count', () => {
    const P3 = '+85290000003'
    for (const n of [1, 2, 3]) psql(insertPending(`a3000000-0000-4000-8000-0000000001a${n}`, P3))
    psql(insertAgent({ id: 'a3000000-0000-4000-8000-0000000001b1', code: 'H2J3K4', phone: P3 }))
    expect(psql(promote(P3, 'H2J3K4', 'wamid.f1'))).toBe('')
    expect(psql(`SELECT status, confirm_code FROM booking_requests WHERE id = 'a3000000-0000-4000-8000-0000000001b1'`)).toBe('unverified|H2J3K4')
    // Same phone at restaurant B: A's three pending leave B's cap untouched.
    psql(insertAgent({ id: 'a3000000-0000-4000-8000-0000000001b2', code: 'H2J3K5', phone: P3, restaurant: B }))
    expect(psql(promote(P3, 'H2J3K5', 'wamid.f1b', B))).toBe('a3000000-0000-4000-8000-0000000001b2')
  })

  it('F1: room for one more pending → a text with two codes promotes only the oldest', () => {
    const P2 = '+85290000002'
    for (const n of [1, 2]) psql(insertPending(`a3000000-0000-4000-8000-0000000002a${n}`, P2))
    psql(insertAgent({ id: 'a3000000-0000-4000-8000-0000000002b1', code: 'J2K3L4', phone: P2, created: "now() - interval '2 minutes'" }))
    psql(insertAgent({ id: 'a3000000-0000-4000-8000-0000000002b2', code: 'J2K3L5', phone: P2 }))
    expect(psql(promote(P2, '', 'wamid.f1c', A, ['J2K3L4', 'J2K3L5']))).toBe('a3000000-0000-4000-8000-0000000002b1')
    expect(psql(`SELECT count(*) FROM booking_requests WHERE restaurant_id = '${A}' AND phone = '${P2}' AND status = 'pending'`)).toBe('3')
  })

  it('F1: two concurrent promotions for one phone with room for one → exactly one wins (advisory lock)', async () => {
    const P1 = '+85290000001'
    for (const n of [1, 2]) psql(insertPending(`a3000000-0000-4000-8000-0000000003a${n}`, P1))
    psql(insertAgent({ id: 'a3000000-0000-4000-8000-0000000003b1', code: 'L2M3N4', phone: P1 }))
    psql(insertAgent({ id: 'a3000000-0000-4000-8000-0000000003b2', code: 'L2M3N5', phone: P1 }))
    for (let round = 0; round < 5; round++) {
      // Reset to two pending + two unverified, then race the two codes.
      psql(`UPDATE booking_requests SET status = 'unverified', verified_at = NULL, verified_wamid = NULL,
              confirm_code = CASE id WHEN 'a3000000-0000-4000-8000-0000000003b1' THEN 'L2M3N4' ELSE 'L2M3N5' END
            WHERE id IN ('a3000000-0000-4000-8000-0000000003b1', 'a3000000-0000-4000-8000-0000000003b2')`)
      const results = await Promise.all([
        psqlAsync(promote(P1, 'L2M3N4', `wamid.r${round}a`)),
        psqlAsync(promote(P1, 'L2M3N5', `wamid.r${round}b`)),
      ])
      expect(results.filter((r) => r.length > 0)).toHaveLength(1)
      expect(psql(`SELECT count(*) FROM booking_requests WHERE restaurant_id = '${A}' AND phone = '${P1}' AND status = 'pending'`)).toBe('3')
    }
  })

  it('F1: promote_agent_booking is service-role only', () => {
    const grants = psql(`SELECT grantee FROM information_schema.routine_privileges
                         WHERE routine_name = 'promote_agent_booking' ORDER BY grantee`)
    expect(grants.split('\n')).toContain('service_role')
    for (const role of ['anon', 'authenticated', 'PUBLIC']) expect(grants.split('\n')).not.toContain(role)
  })

  it('R33/R43: the agent booking id is unique across restaurants and found by its JSON path', () => {
    const pid = 'P'.repeat(32)
    psql(`UPDATE restaurants SET booking_config = '{"mode":"simple","agentBooking":{"enabled":true,"publicId":"${pid}"}}' WHERE id = '${A}'`)
    expect(fails(`UPDATE restaurants SET booking_config = '{"mode":"simple","agentBooking":{"publicId":"${pid}"}}' WHERE id = '${B}'`)).toBe(true)
    expect(psql(`SELECT id FROM restaurants WHERE booking_config -> 'agentBooking' ->> 'publicId' = '${pid}'`)).toBe(A)
    expect(psql(`EXPLAIN SELECT id FROM restaurants WHERE booking_config -> 'agentBooking' ->> 'publicId' = '${pid}'`))
      .toMatch(/restaurants_agent_booking_public_id_idx|Seq Scan/)
  })
})
