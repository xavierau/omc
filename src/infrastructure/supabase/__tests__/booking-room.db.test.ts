/**
 * DB INTEGRATION TESTS for migration 092 (BOOK-010, spec AC-5, AC-6; plan D4;
 * threat R5). Fakes cannot show a race (memory: fakes hid schema mismatch):
 * that two requests for the last seats create exactly one booking is a
 * property of the advisory lock + count + insert inside
 * insert_booking_request_if_room, so it runs against a real Postgres here.
 *
 * Gated behind `RUN_DB_TESTS=1` like booking.db.test.ts, through `psql`. The
 * scratch database comes from scripts/book-010/scratch-db.sh (every
 * migration 001..092, storage stubs), never DEV or prod:
 *
 *   scripts/book-010/scratch-db.sh up
 *   RUN_DB_TESTS=1 PGPORT=55492 PGUSER=postgres PGDATABASE=postgres \
 *     npx vitest run src/infrastructure/supabase/__tests__/booking-room.db.test.ts
 *   scripts/book-010/scratch-db.sh down
 *
 * Calls run as service_role (the only role granted EXECUTE); each test's
 * rows belong to a restaurant it creates and deletes (cleanup deletes only
 * what the run created).
 */
import { execFile, execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { promisify } from 'node:util'
import { describe, it, expect, afterEach } from 'vitest'

const RUN = process.env.RUN_DB_TESTS === '1'
const d = RUN ? describe : describe.skip
const execFileAsync = promisify(execFile)

const PG = {
  host: process.env.PGHOST ?? '127.0.0.1',
  port: process.env.PGPORT ?? '55492',
  user: process.env.PGUSER ?? 'postgres',
  password: process.env.PGPASSWORD ?? 'postgres',
  database: process.env.PGDATABASE ?? 'postgres',
}

const args = (sql: string) => ['-X', '-h', PG.host, '-p', PG.port, '-U', PG.user, '-d', PG.database, '-v', 'ON_ERROR_STOP=1', '-qtAc', sql]
const env = () => ({ ...process.env, PGPASSWORD: PG.password })
const psql = (sql: string) => execFileSync('psql', args(sql), { env: env(), encoding: 'utf8' }).trim()
const psqlAsync = async (sql: string) => (await execFileAsync('psql', args(sql), { env: env(), encoding: 'utf8' })).stdout.trim()

function error(sql: string): string {
  try {
    execFileSync('psql', args(sql), { env: env(), encoding: 'utf8', stdio: 'pipe' })
    return ''
  } catch (err) {
    return String((err as { stderr?: string }).stderr ?? err)
  }
}

const DAY = '2026-11-21'
const created: string[] = []

function restaurant(): string {
  const id = randomUUID()
  psql(`INSERT INTO restaurants (id, name, slug, whatsapp_number) VALUES ('${id}', 'BOOK-010 race', 'book010-${id}', '+85230000000')`)
  created.push(id)
  return id
}

afterEach(() => {
  for (const id of created.splice(0)) psql(`DELETE FROM restaurants WHERE id = '${id}'`)
})

function seat(rid: string, time: string, party: number, status = 'confirmed') {
  const decided = status === 'confirmed' || status === 'declined' ? 'now()' : 'NULL'
  psql(
    `INSERT INTO booking_requests (restaurant_id, phone, name, party_size, booking_date, booking_time, source, status, decided_at)
     VALUES ('${rid}', '+85290000000', 'seed', ${party}, '${DAY}', '${time}', 'chat', '${status}', ${decided})`
  )
}

const row = (rid: string, name: string, time = '19:00', party = 4) =>
  JSON.stringify({
    restaurant_id: rid, member_id: null, phone: '+85291234567', name, party_size: party, booking_date: DAY, booking_time: time,
    notes: null, source: 'agent', campaign_id: null, token: null,
  })

/** One call of the function, as the app makes it (service role, the dinner period, 30 per slot / 60 per meal). */
const call = (rid: string, name: string, opts: { time?: string; slot?: number | null; meal?: number | null } = {}) =>
  `SELECT public.insert_booking_request_if_room('${row(rid, name, opts.time)}'::jsonb, '晚市', '18:00', '21:30', ` +
  `${opts.slot === undefined ? 30 : opts.slot ?? 'NULL'}, ${opts.meal === undefined ? 60 : opts.meal ?? 'NULL'})`

const asService = (sql: string) => `SET ROLE service_role; ${sql}`
const inserted = (rid: string, prefix: string) =>
  Number(psql(`SELECT count(*) FROM booking_requests WHERE restaurant_id = '${rid}' AND name LIKE '${prefix}%'`))

d('BOOK-010 migration 092 on real Postgres', () => {
  it('AC-5: two calls for the last 4 seats at once → exactly one insert (the second waits for the lock, then counts the first)', async () => {
    const rid = restaurant()
    seat(rid, '19:00', 26)
    const started = Date.now()
    const holder = psqlAsync(`BEGIN; SET ROLE service_role; ${call(rid, 'race-A')}; SELECT pg_sleep(1.5); COMMIT;`)
    await new Promise((r) => setTimeout(r, 300))
    const t0 = Date.now()
    const second = await psqlAsync(asService(call(rid, 'race-B')))
    const waitedMs = Date.now() - t0
    const first = await holder
    console.log(`[race] A=${first.replace(/\n/g, ' ')} | B=${second} | B waited ${waitedMs} ms (A held its lock ~1.5 s from ${t0 - started} ms)`)
    expect(first).toContain('"ok": true')
    expect(JSON.parse(second)).toEqual({ ok: false, refusal: { kind: 'full', scope: 'slot', guests: 30, limit: 30 } })
    expect(waitedMs).toBeGreaterThan(900)
    expect(inserted(rid, 'race-')).toBe(1)
  })

  it('AC-5: 12 concurrent calls with room for exactly 3 parties of 4 → exactly 3 inserts', async () => {
    const rid = restaurant()
    seat(rid, '19:00', 18)
    const results = await Promise.all(Array.from({ length: 12 }, (_, i) => psqlAsync(asService(call(rid, `fuzz-${i}`)))))
    const ok = results.filter((r) => JSON.parse(r).ok === true).length
    console.log(`[fuzz] ${ok} of 12 inserted; slot guests now ${psql(`SELECT sum(party_size) FROM booking_requests WHERE restaurant_id = '${rid}' AND booking_time = '19:00'`)}`)
    expect(ok).toBe(3)
    expect(inserted(rid, 'fuzz-')).toBe(3)
  })

  it('AC-5: the meal limit holds across different slots of one period (the lock is per date)', async () => {
    const rid = restaurant()
    seat(rid, '18:00', 28)
    seat(rid, '18:30', 28)
    const results = await Promise.all(
      ['19:00', '19:30', '20:00', '20:30'].map((time) => psqlAsync(asService(call(rid, `meal-${time}`, { time, slot: null, meal: 60 }))))
    )
    expect(results.filter((r) => JSON.parse(r).ok === true)).toHaveLength(1)
    expect(results.filter((r) => r.includes('"scope": "meal"'))).toHaveLength(3)
  })

  it('counting: unverified and declined rows never count; a stop refuses before any count', () => {
    const rid = restaurant()
    psql(
      `INSERT INTO booking_requests (restaurant_id, phone, name, party_size, booking_date, booking_time, source, status, confirm_code, verify_expires_at)
       VALUES ('${rid}', '+85290000001', 'seed', 40, '${DAY}', '19:00', 'agent', 'unverified', 'K7PX3M', now() + interval '30 minutes')`
    )
    seat(rid, '19:00', 40, 'declined')
    expect(JSON.parse(psql(asService(call(rid, 'count-ok')))).ok).toBe(true)
    expect(JSON.parse(psql(`SELECT public.booking_guest_counts('${rid}', '${DAY}', '${DAY}')`))).toEqual({ [DAY]: { '19:00': 4 } })
    psql(`INSERT INTO booking_stops (restaurant_id, booking_date, scope, period_label) VALUES ('${rid}', '${DAY}', 'period', '晚市')`)
    expect(JSON.parse(psql(asService(call(rid, 'count-stopped', { slot: null, meal: null }))))).toEqual({
      ok: false, refusal: { kind: 'stopped', scope: 'period' },
    })
  })

  it('the inserted row is the plain insert’s row: pending, every passed column, nothing else allowed', () => {
    const rid = restaurant()
    const out = JSON.parse(psql(asService(call(rid, 'shape'))))
    expect(out.row).toMatchObject({ status: 'pending', source: 'agent', party_size: 4, booking_time: '19:00:00', name: 'shape' })
    const smuggled = JSON.stringify({ ...JSON.parse(row(rid, 'x')), status: 'confirmed' })
    expect(error(asService(`SELECT public.insert_booking_request_if_room('${smuggled}'::jsonb, NULL, NULL, NULL, NULL, NULL)`))).toContain(
      'column status is not allowed'
    )
  })

  it('AC-6: the code step declines a candidate whose slot filled ("full") and promotes one that fits', () => {
    const rid = restaurant()
    seat(rid, '19:00', 28)
    const phone = '+85291112222'
    const add = (time: string, code: string) =>
      psql(
        `INSERT INTO booking_requests (restaurant_id, phone, name, party_size, booking_date, booking_time, source, status, confirm_code, verify_expires_at)
         VALUES ('${rid}', '${phone}', 'pap', 4, '${DAY}', '${time}', 'agent', 'unverified', '${code}', now() + interval '30 minutes') RETURNING id`
      )
    const full = add('19:00', 'K7PX3M')
    const fits = add('20:00', 'Q2W3E4')
    const room = (id: string) => `"${id}": {"period_key": "晚市", "period_first": "18:00", "period_last": "21:30", "slot_limit": 30, "meal_limit": null}`
    const rows = psql(
      asService(
        `SELECT id || ':' || status || ':' || coalesce(decline_reason, '') FROM public.promote_agent_booking_with_room(` +
          `'${rid}', '${phone}', ARRAY['K7PX3M', 'Q2W3E4'], 'wamid.1', now(), 3, '{${room(full)}, ${room(fits)}}'::jsonb)`
      )
    ).split('\n')
    expect(rows.sort()).toEqual([`${full}:declined:full`, `${fits}:pending:`].sort())
    expect(psql(`SELECT status || ',' || (decided_at IS NOT NULL) || ',' || (confirm_code IS NULL) FROM booking_requests WHERE id = '${full}'`)).toBe(
      'declined,true,true'
    )
  })

  it('R5: anon and authenticated cannot execute any 092 function (permission denied)', () => {
    const rid = randomUUID()
    const fns = [
      call(rid, 'x'),
      `SELECT public.booking_guest_counts('${rid}', '${DAY}', '${DAY}')`,
      `SELECT public.booking_room_refusal('${rid}', '${DAY}', '19:00', 1, NULL, NULL, NULL, NULL, NULL)`,
      `SELECT public.booking_room_lock('${rid}', '${DAY}')`,
      `SELECT * FROM public.promote_agent_booking_with_room('${rid}', '+1', ARRAY['K7PX3M'], 'w', now(), 3, '{}'::jsonb)`,
    ]
    for (const role of ['anon', 'authenticated']) {
      for (const fn of fns) {
        const message = error(`SET ROLE ${role}; ${fn}`)
        console.log(`[grants] ${role}: ${message.split('\n')[0]}`)
        expect(message).toContain('permission denied for function')
      }
    }
  })

  it('R3: anon and authenticated read no booking_stops rows (RLS on, no policies)', () => {
    const rid = restaurant()
    psql(`INSERT INTO booking_stops (restaurant_id, booking_date, scope) VALUES ('${rid}', '${DAY}', 'day')`)
    for (const role of ['anon', 'authenticated']) {
      const out = error(`SET ROLE ${role}; SELECT count(*) FROM booking_stops`)
      const count = out === '' ? psql(`SET ROLE ${role}; SELECT count(*) FROM booking_stops`) : 'denied'
      expect(['0', 'denied']).toContain(count)
    }
  })
})
