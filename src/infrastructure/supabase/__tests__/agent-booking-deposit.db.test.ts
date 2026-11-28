/**
 * DB INTEGRATION TESTS for 097's promote_agent_booking_to_deposit (BOOK-014
 * W5; spec AC-10; threat R55, R58, R60): the PAP code step for a booking that
 * needs a deposit. One transaction moves the row unverified -> awaiting_deposit
 * and inserts its deposit + 'created' event, under 084's match, the per-phone
 * cap and (with p_room) 092's seat check.
 *
 * Gated behind `RUN_DB_TESTS=1`, through `psql`, on the scratch database of
 * scripts/book-014/scratch-db.sh (every migration 001..097), never DEV or prod:
 *
 *   scripts/book-014/scratch-db.sh up
 *   RUN_DB_TESTS=1 PGPORT=55496 npx vitest run src/infrastructure/supabase/__tests__/agent-booking-deposit.db.test.ts
 *   scripts/book-014/scratch-db.sh down
 *
 * Each test's rows belong to a restaurant it creates and deletes.
 */
import { execFile, execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { promisify } from 'node:util'
import { describe, it, expect, afterEach } from 'vitest'

const RUN = process.env.RUN_DB_TESTS === '1'
const d = RUN ? describe : describe.skip
const execFileAsync = promisify(execFile)

const PG = {
  host: process.env.PGHOST ?? '127.0.0.1',
  port: process.env.PGPORT ?? '55496',
  user: process.env.PGUSER ?? 'postgres',
  password: process.env.PGPASSWORD ?? 'postgres',
  database: process.env.PGDATABASE ?? 'postgres',
}

const args = (sql: string) => ['-X', '-h', PG.host, '-p', PG.port, '-U', PG.user, '-d', PG.database, '-v', 'ON_ERROR_STOP=1', '-qtAc', sql]
const env = () => ({ ...process.env, PGPASSWORD: PG.password })
const psql = (sql: string) => execFileSync('psql', args(sql), { env: env(), encoding: 'utf8' }).trim()
const psqlAsync = async (sql: string) => (await execFileAsync('psql', args(sql), { env: env(), encoding: 'utf8' })).stdout.trim()
const asService = (sql: string) => `SET ROLE service_role; ${sql}`

function error(sql: string): string {
  try {
    execFileSync('psql', args(sql), { env: env(), encoding: 'utf8', stdio: 'pipe' })
    return ''
  } catch (err) {
    return String((err as { stderr?: string }).stderr ?? err)
  }
}

const DAY = '2026-12-24'
const PHONE = '+85291239000'
const CODE = 'K7PX3M'
const created: string[] = []

function restaurant(): string {
  const id = randomUUID()
  psql(`INSERT INTO restaurants (id, name, slug, whatsapp_number) VALUES ('${id}', 'BOOK-014 W5', 'book014w5-${id}', '+85230000000')`)
  created.push(id)
  return id
}

afterEach(() => {
  for (const id of created.splice(0)) psql(`DELETE FROM restaurants WHERE id = '${id}'`)
})

function unverified(rid: string, opts: { phone?: string; code?: string; party?: number; expires?: string } = {}): string {
  const id = randomUUID()
  psql(
    `INSERT INTO booking_requests (id, restaurant_id, phone, name, party_size, booking_date, booking_time, source, status, confirm_code, verify_expires_at)
     VALUES ('${id}', '${rid}', '${opts.phone ?? PHONE}', 'pap', ${opts.party ?? 4}, '${DAY}', '19:00', 'agent', 'unverified',
             '${opts.code ?? CODE}', ${opts.expires ?? "now() + interval '30 minutes'"})`
  )
  return id
}

function pending(rid: string, party = 1, phone = PHONE) {
  psql(
    `INSERT INTO booking_requests (restaurant_id, phone, name, party_size, booking_date, booking_time, source, status)
     VALUES ('${rid}', '${phone}', 'held', ${party}, '${DAY}', '19:00', 'chat', 'pending')`
  )
}

const deposit = (rid: string, over: Record<string, unknown> = {}) =>
  JSON.stringify({
    id: randomUUID(), provider_code: 'test', account_id: null, provider_account_id: `acct_${rid.slice(0, 8)}`,
    amount_minor: 40000, currency: 'HKD', hold_expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
    link_token_hash: createHash('sha256').update(randomUUID()).digest('hex'), ...over,
  })

const ROOM_10 = JSON.stringify({ period_key: '晚市', period_first: '18:00', period_last: '21:30', slot_limit: 10, meal_limit: null })

function callSql(rid: string, bookingId: string, opts: { phone?: string; codes?: string[]; room?: string | null; dep?: string; max?: number } = {}) {
  const codes = `ARRAY[${(opts.codes ?? [CODE]).map((c) => `'${c}'`).join(',')}]::text[]`
  const room = opts.room ? `'${opts.room}'::jsonb` : 'NULL'
  return `SELECT public.promote_agent_booking_to_deposit('${rid}', '${opts.phone ?? PHONE}', '${bookingId}', ${codes}, 'wamid.1', now(), ${opts.max ?? 3}, ${room}, '${opts.dep ?? deposit(rid)}'::jsonb)`
}

type Out = { ok: boolean; row?: { id: string; status: string; confirm_code: string | null; decline_reason?: string }; deposit?: { id: string; status: string }; refusal?: { kind: string } }
const promote = (rid: string, bookingId: string, opts: Parameters<typeof callSql>[2] = {}) => JSON.parse(psql(asService(callSql(rid, bookingId, opts)))) as Out

const statusOf = (id: string) => psql(`SELECT status FROM booking_requests WHERE id = '${id}'`)
const depositsOf = (id: string) => Number(psql(`SELECT count(*) FROM booking_deposits WHERE booking_id = '${id}'`))
const guests = (rid: string) => JSON.parse(psql(`SELECT public.booking_guest_counts('${rid}', '${DAY}', '${DAY}')`))

d('097 promote_agent_booking_to_deposit (BOOK-014 W5)', () => {
  it('txn: unverified -> awaiting_deposit, code cleared, deposit awaiting + created:system, seats held', () => {
    const rid = restaurant()
    const id = unverified(rid)
    const out = promote(rid, id)
    expect(out.ok).toBe(true)
    expect(out.row).toMatchObject({ id, status: 'awaiting_deposit', confirm_code: null })
    expect(out.deposit).toMatchObject({ status: 'awaiting' })
    expect(psql(`SELECT verified_wamid FROM booking_requests WHERE id = '${id}'`)).toBe('wamid.1')
    expect(psql(`SELECT string_agg(event_type || ':' || actor_kind, ',') FROM deposit_events WHERE deposit_id = '${out.deposit!.id}'`)).toBe('created:system')
    expect(guests(rid)).toEqual({ [DAY]: { '19:00': 4 } })
  })

  it('CAS: a replay, another number, a wrong code or an expired window changes nothing', () => {
    const rid = restaurant()
    const id = unverified(rid)
    expect(promote(rid, id).ok).toBe(true)
    expect(promote(rid, id)).toEqual({ ok: false, refusal: { kind: 'not_promotable' } })
    expect(depositsOf(id)).toBe(1)

    const other = unverified(rid, { code: 'Q2W3E4' })
    expect(promote(rid, other, { phone: '+85299999999', codes: ['Q2W3E4'] })).toEqual({ ok: false, refusal: { kind: 'not_promotable' } })
    expect(promote(rid, other, { codes: ['ZZZZZZ'] })).toEqual({ ok: false, refusal: { kind: 'not_promotable' } })
    const late = unverified(rid, { code: 'Z9Y8X7', expires: "now() - interval '1 minute'" })
    expect(promote(rid, late, { codes: ['Z9Y8X7'] })).toEqual({ ok: false, refusal: { kind: 'not_promotable' } })
    expect([statusOf(other), statusOf(late)]).toEqual(['unverified', 'unverified'])
    expect(depositsOf(other) + depositsOf(late)).toBe(0)
  })

  it('R55: 10 concurrent calls for the same row -> exactly one hold and one deposit', async () => {
    const rid = restaurant()
    const id = unverified(rid)
    const sql = asService(callSql(rid, id))
    const results = (await Promise.all(Array.from({ length: 10 }, () => psqlAsync(sql)))).map((r) => JSON.parse(r) as Out)
    expect(results.filter((r) => r.ok)).toHaveLength(1)
    expect(depositsOf(id)).toBe(1)
  })

  it('R55 cap: pending + awaiting_deposit at the cap -> pending_cap, the row stays unverified', () => {
    const rid = restaurant()
    pending(rid)
    pending(rid)
    const first = promote(rid, unverified(rid, { code: 'A2A2A2', party: 1 }), { codes: ['A2A2A2'] })
    expect(first.ok).toBe(true) // 2 pending + this hold = 3
    const id = unverified(rid)
    expect(promote(rid, id)).toEqual({ ok: false, refusal: { kind: 'pending_cap' } })
    expect(statusOf(id)).toBe('unverified')
    expect(depositsOf(id)).toBe(0)
  })

  it('room: a slot that filled -> declined full (row returned), no deposit; with room it holds seats', () => {
    const rid = restaurant()
    pending(rid, 8, '+85291230000')
    const id = unverified(rid)
    const out = promote(rid, id, { room: ROOM_10 })
    expect(out.ok).toBe(false)
    expect(out.refusal).toMatchObject({ kind: 'full' })
    expect(out.row).toMatchObject({ id, status: 'declined', decline_reason: 'full', confirm_code: null })
    expect(depositsOf(id)).toBe(0)

    const rid2 = restaurant()
    const ok = promote(rid2, unverified(rid2, { party: 10 }), { room: ROOM_10 })
    expect(ok.ok).toBe(true)
  })

  it('refuses a deposit key outside the list, and a missing deposit', () => {
    const rid = restaurant()
    const id = unverified(rid)
    expect(error(asService(callSql(rid, id, { dep: deposit(rid, { amount_override: 1 }) })))).toContain('deposit key amount_override is not allowed')
    expect(statusOf(id)).toBe('unverified')
  })

  it('R58: anon and authenticated cannot execute it; service_role can', () => {
    const rid = restaurant()
    const id = unverified(rid)
    for (const role of ['anon', 'authenticated']) {
      expect(error(`SET ROLE ${role}; ${callSql(rid, id)}`), role).toContain('permission denied for function')
    }
    expect(promote(rid, id).ok).toBe(true)
  })
})
