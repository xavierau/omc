/**
 * DB INTEGRATION TESTS for migration 085 (AGENT-003 R19, R23, R24) on a real
 * Postgres. The SQL mirrors what booking-request-repository.ts sends through
 * PostgREST. Gated behind `RUN_DB_TESTS=1`; `PGDATABASE` names a database
 * with every migration through 085 applied (the local Supabase stack works).
 *
 *   RUN_DB_TESTS=1 PGPORT=54322 PGUSER=postgres PGDATABASE=postgres \
 *     npx vitest run src/infrastructure/supabase/__tests__/agent-booking-changes.db.test.ts
 */
import { execFileSync } from 'node:child_process'
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'

const RUN = process.env.RUN_DB_TESTS === '1'
const d = RUN ? describe : describe.skip

const PG = {
  host: process.env.PGHOST ?? '127.0.0.1',
  port: process.env.PGPORT ?? '54322',
  user: process.env.PGUSER ?? 'postgres',
  password: process.env.PGPASSWORD ?? 'postgres',
  database: process.env.PGDATABASE ?? 'postgres',
}
const args = (sql: string) => ['-h', PG.host, '-p', PG.port, '-U', PG.user, '-d', PG.database, '-v', 'ON_ERROR_STOP=1', '-qtAc', sql]
const env = () => ({ ...process.env, PGPASSWORD: PG.password })
const psql = (sql: string) => execFileSync('psql', args(sql), { env: env(), encoding: 'utf8' }).trim()
function fails(sql: string): boolean {
  try {
    execFileSync('psql', args(sql), { env: env(), encoding: 'utf8', stdio: 'pipe' })
    return false
  } catch {
    return true
  }
}

const A = 'a3850000-0000-4000-8000-00000000000a'
const B = 'a3850000-0000-4000-8000-00000000000b'
const PHONE = '+85291234567'
const OTHER = '+85298765432'
const ORIG = 'a3850000-0000-4000-8000-0000000000f1'
const CHANGE = 'a3850000-0000-4000-8000-0000000000f2'
const STAFF = 'a3850000-0000-4000-8000-0000000000aa'

const insert = (id: string, opts: { status?: string; replaces?: string; phone?: string; restaurant?: string; date?: string } = {}) =>
  `INSERT INTO booking_requests (id, restaurant_id, phone, name, party_size, booking_date, booking_time, status, source, decided_at, replaces_booking_id)
     VALUES ('${id}', '${opts.restaurant ?? A}', '${opts.phone ?? PHONE}', 'Chan', 4, ${opts.date ?? 'current_date + 6'}, '19:30',
       '${opts.status ?? 'pending'}', 'agent', ${opts.status === 'confirmed' ? 'now()' : 'NULL'}, ${opts.replaces ? `'${opts.replaces}'` : 'NULL'})`
const statusOf = (id: string) => psql(`SELECT status || '|' || coalesce(cancelled_by, '-') FROM booking_requests WHERE id = '${id}'`)
const confirmChange = (id: string, restaurant = A) =>
  psql(`SELECT id FROM confirm_booking_change('${id}', '${restaurant}', '${STAFF}', now())`)
// booking-request-repository.ts cancelDinerBooking (one UPDATE, PostgREST or= filter).
const dinerCancel = (id: string, phone = PHONE) =>
  psql(`UPDATE booking_requests SET status = 'cancelled', cancelled_by = 'diner_ai', cancelled_at = now()
         WHERE restaurant_id = '${A}' AND phone = '${phone}' AND status IN ('pending', 'confirmed')
           AND booking_date >= current_date AND (id = '${id}' OR (replaces_booking_id = '${id}' AND status = 'pending'))
         RETURNING id`)

const cleanup = () => psql(`DELETE FROM restaurants WHERE id IN ('${A}', '${B}')`)

d('migration 085 (real Postgres)', () => {
  beforeAll(() => {
    cleanup()
    psql(`INSERT INTO restaurants (id, name, slug, whatsapp_number) VALUES
      ('${A}', 'A3 DB A', 'a3-db-a-085', '+85230000001'), ('${B}', 'A3 DB B', 'a3-db-b-085', '+85230000002')`)
  })
  afterAll(() => cleanup())
  beforeEach(() => psql(`DELETE FROM booking_requests WHERE restaurant_id IN ('${A}', '${B}')`))

  it('AC-R24 a cancelled row needs its marker and cancel time; the marker needs the status', () => {
    psql(insert(ORIG, { status: 'confirmed' }))
    expect(fails(`UPDATE booking_requests SET status = 'cancelled' WHERE id = '${ORIG}'`)).toBe(true)
    expect(fails(`UPDATE booking_requests SET status = 'cancelled', cancelled_by = 'diner_ai' WHERE id = '${ORIG}'`)).toBe(true)
    expect(fails(`UPDATE booking_requests SET cancelled_by = 'diner_ai' WHERE id = '${ORIG}'`)).toBe(true)
    expect(fails(`UPDATE booking_requests SET status = 'cancelled', cancelled_by = 'staff', cancelled_at = now() WHERE id = '${ORIG}'`)).toBe(true)
    psql(`UPDATE booking_requests SET status = 'cancelled', cancelled_by = 'diner_ai', cancelled_at = now() WHERE id = '${ORIG}'`)
    expect(statusOf(ORIG)).toBe('cancelled|diner_ai')
  })

  it('AC-R23 one open change request per booking', () => {
    psql(insert(ORIG, { status: 'confirmed' }))
    psql(insert(CHANGE, { replaces: ORIG }))
    expect(fails(insert('a3850000-0000-4000-8000-0000000000f3', { replaces: ORIG }))).toBe(true)
  })

  it('AC-R23 confirm_booking_change confirms the change and cancels the original (by change) together', () => {
    psql(insert(ORIG, { status: 'confirmed' }))
    psql(insert(CHANGE, { replaces: ORIG }))
    expect(confirmChange(CHANGE)).toBe(CHANGE)
    expect(statusOf(CHANGE)).toBe('confirmed|-')
    expect(statusOf(ORIG)).toBe('cancelled|change')
    expect(confirmChange(CHANGE)).toBe('') // single use
  })

  it('AC-R23 another restaurant or a booking that is not a change request → no row, nothing changed', () => {
    psql(insert(ORIG, { status: 'confirmed' }))
    psql(insert(CHANGE, { replaces: ORIG }))
    expect(confirmChange(CHANGE, B)).toBe('')
    expect(confirmChange(ORIG)).toBe('')
    expect(statusOf(CHANGE)).toBe('pending|-')
    expect(statusOf(ORIG)).toBe('confirmed|-')
  })

  it('AC-R23 a failure while cancelling the original rolls the confirm back (one transaction)', () => {
    psql(insert(ORIG, { status: 'confirmed' }))
    psql(insert(CHANGE, { replaces: ORIG }))
    psql(`CREATE OR REPLACE FUNCTION a3_085_block() RETURNS trigger AS $$
            BEGIN IF NEW.id = '${ORIG}' AND NEW.status = 'cancelled' THEN RAISE EXCEPTION 'blocked'; END IF; RETURN NEW; END $$ LANGUAGE plpgsql;
          CREATE TRIGGER a3_085_block BEFORE UPDATE ON booking_requests FOR EACH ROW EXECUTE FUNCTION a3_085_block();`)
    try {
      expect(fails(`SELECT id FROM confirm_booking_change('${CHANGE}', '${A}', '${STAFF}', now())`)).toBe(true)
    } finally {
      psql('DROP TRIGGER a3_085_block ON booking_requests; DROP FUNCTION a3_085_block();')
    }
    expect(statusOf(CHANGE)).toBe('pending|-')
    expect(statusOf(ORIG)).toBe('confirmed|-')
  })

  it('AC-R23 a staff decline leaves the original as it was', () => {
    psql(insert(ORIG, { status: 'confirmed' }))
    psql(insert(CHANGE, { replaces: ORIG }))
    psql(`UPDATE booking_requests SET status = 'declined', decided_by = '${STAFF}', decided_at = now()
           WHERE id = '${CHANGE}' AND restaurant_id = '${A}' AND status = 'pending'`)
    expect(statusOf(ORIG)).toBe('confirmed|-')
  })

  it('AC-R24 the diner cancel takes the booking and its open change request, never another phone’s or a past one', () => {
    psql(insert(ORIG, { status: 'confirmed' }))
    psql(insert(CHANGE, { replaces: ORIG }))
    psql(insert('a3850000-0000-4000-8000-0000000000f4', { phone: OTHER }))
    psql(insert('a3850000-0000-4000-8000-0000000000f5', { date: 'current_date - 1' }))
    expect(dinerCancel(ORIG).split('\n').sort()).toEqual([ORIG, CHANGE].sort())
    expect(dinerCancel('a3850000-0000-4000-8000-0000000000f4')).toBe('')
    expect(dinerCancel('a3850000-0000-4000-8000-0000000000f5')).toBe('')
    expect(statusOf('a3850000-0000-4000-8000-0000000000f4')).toBe('pending|-')
  })

  it('AC-R24 the reminder RPC never returns a cancelled booking', () => {
    psql(`INSERT INTO booking_requests (id, restaurant_id, phone, name, party_size, booking_date, booking_time, status, source, decided_at, cancelled_by, cancelled_at, created_at)
            VALUES ('${ORIG}', '${A}', '${PHONE}', 'Chan', 2, (now() AT TIME ZONE 'Asia/Hong_Kong' + interval '2 hours')::date,
                    ((now() AT TIME ZONE 'Asia/Hong_Kong') + interval '2 hours')::time, 'cancelled', 'agent', now(), 'diner_ai', now(), now() - interval '2 days')`)
    psql(`INSERT INTO booking_requests (id, restaurant_id, phone, name, party_size, booking_date, booking_time, status, source, decided_at, created_at)
            VALUES ('${CHANGE}', '${A}', '${PHONE}', 'Chan', 2, (now() AT TIME ZONE 'Asia/Hong_Kong' + interval '2 hours')::date,
                    ((now() AT TIME ZONE 'Asia/Hong_Kong') + interval '2 hours')::time, 'confirmed', 'agent', now(), now() - interval '2 days')`)
    const due = psql(`SELECT id FROM booking_reminder_candidates(now(), 24, 500) WHERE restaurant_id = '${A}'`)
    expect(due).toBe(CHANGE)
  })

  it('AC-R19 agent_messages accepts handoff and it claims the one reply per user row', () => {
    const user = 'a3850000-0000-4000-8000-0000000000e1'
    psql(`INSERT INTO agent_messages (id, restaurant_id, phone, role, text, wamid) VALUES ('${user}', '${A}', '${PHONE}', 'user', 'hi', 'wamid.a3.085')`)
    psql(`INSERT INTO agent_messages (restaurant_id, phone, role, text, outcome, reply_to_message_id) VALUES ('${A}', '${PHONE}', 'model', 'sorry', 'handoff', '${user}')`)
    expect(fails(`INSERT INTO agent_messages (restaurant_id, phone, role, text, outcome, reply_to_message_id) VALUES ('${A}', '${PHONE}', 'model', 'x', 'sent', '${user}')`)).toBe(true)
    expect(fails(`INSERT INTO agent_messages (restaurant_id, phone, role, outcome) VALUES ('${A}', '${PHONE}', 'model', 'bogus')`)).toBe(true)
  })
})
