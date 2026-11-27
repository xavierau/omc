/**
 * DB INTEGRATION TESTS for migration 097 (BOOK-014 W1; threat R55, R56, R57,
 * R58, R60). Fakes cannot show a race or a CHECK (memory: fakes hid schema
 * mismatch), so the seat hold, the per-phone cap, the lapse/paid CAS and the
 * refund/keep CAS run against a real Postgres here.
 *
 * Gated behind `RUN_DB_TESTS=1`, through `psql`, on the scratch database of
 * scripts/book-014/scratch-db.sh (every migration 001..097), never DEV or prod:
 *
 *   scripts/book-014/scratch-db.sh up
 *   RUN_DB_TESTS=1 PGPORT=55496 npx vitest run src/infrastructure/supabase/__tests__/booking-deposits.db.test.ts
 *   scripts/book-014/scratch-db.sh down
 *
 * Calls run as service_role (the only role granted EXECUTE); each test's rows
 * belong to a restaurant it creates and deletes (cleanup deletes only what
 * the run created).
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
const created: string[] = []

function restaurant(): string {
  const id = randomUUID()
  psql(`INSERT INTO restaurants (id, name, slug, whatsapp_number) VALUES ('${id}', 'BOOK-014 deposits', 'book014-${id}', '+85230000000')`)
  created.push(id)
  return id
}

afterEach(() => {
  for (const id of created.splice(0)) psql(`DELETE FROM restaurants WHERE id = '${id}'`)
})

type RowOpts = { phone?: string | null; party?: number; source?: string; createdBy?: string }

const row = (rid: string, name: string, opts: RowOpts = {}) =>
  JSON.stringify({
    restaurant_id: rid, member_id: null, phone: opts.phone === undefined ? '+85291234567' : opts.phone, name, party_size: opts.party ?? 4,
    booking_date: DAY, booking_time: '19:00', notes: null, source: opts.source ?? 'chat', campaign_id: null, token: null,
    ...(opts.createdBy ? { created_by: opts.createdBy } : {}),
  })

const tokenHash = () => createHash('sha256').update(randomUUID()).digest('hex')

const deposit = (rid: string, over: Record<string, unknown> = {}) =>
  JSON.stringify({
    id: randomUUID(), provider_code: 'test', account_id: null, provider_account_id: `acct_${rid.slice(0, 8)}`,
    amount_minor: 40000, currency: 'HKD', hold_expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
    link_token_hash: tokenHash(), ...over,
  })

/** insert_booking_request_if_room as the deposit channels call it: 10 seats per slot. */
function insertAwaiting(rid: string, name: string, opts: RowOpts & { hold?: string; maxPending?: number | null } = {}) {
  const dep = deposit(rid, opts.hold ? { hold_expires_at: opts.hold } : {})
  const max = opts.maxPending === undefined ? 3 : opts.maxPending ?? 'NULL'
  const out = JSON.parse(
    psql(
      asService(
        `SELECT public.insert_booking_request_if_room('${row(rid, name, opts)}'::jsonb, '晚市', '18:00', '21:30', 10, NULL, ` +
          `'awaiting_deposit', '${dep}'::jsonb, ${max})`
      )
    )
  )
  return out as { ok: boolean; row?: { id: string; status: string }; deposit?: { id: string; status: string }; refusal?: unknown }
}

function insertPending(rid: string, name: string, opts: { phone?: string; party?: number; maxPending?: number | null } = {}) {
  const max = opts.maxPending === undefined ? 3 : opts.maxPending ?? 'NULL'
  return JSON.parse(
    psql(asService(`SELECT public.insert_booking_request_if_room('${row(rid, name, opts)}'::jsonb, '晚市', '18:00', '21:30', 10, NULL, 'pending', NULL, ${max})`))
  ) as { ok: boolean; refusal?: unknown }
}

const statusOf = (bookingId: string) => psql(`SELECT status FROM booking_requests WHERE id = '${bookingId}'`)
const depositStatus = (depositId: string) => psql(`SELECT status FROM booking_deposits WHERE id = '${depositId}'`)
const events = (depositId: string) =>
  psql(`SELECT string_agg(event_type || ':' || actor_kind, ',' ORDER BY created_at, event_type) FROM deposit_events WHERE deposit_id = '${depositId}'`)
const expire = (depositId: string) =>
  psql(`UPDATE booking_deposits SET hold_expires_at = now() - interval '1 minute' WHERE id = '${depositId}'`)
const lapse = (limit = 200, only?: string) =>
  psql(asService(`SELECT coalesce(string_agg(id::text, ','), '') FROM public.lapse_expired_booking_deposits(${limit}${only ? `, '${only}'` : ''})`))
const paid = (depositId: string, ref = 'pay_1') =>
  JSON.parse(psql(asService(`SELECT public.mark_booking_deposit_paid('${depositId}', '${ref}', now())`))) as {
    outcome: string
    deposit?: { status: string; refund_reason: string | null; refund_attempts: number }
    booking?: { status: string }
  }
const guests = (rid: string) => JSON.parse(psql(`SELECT public.booking_guest_counts('${rid}', '${DAY}', '${DAY}')`))

d('BOOK-014 migration 097 on real Postgres', () => {
  it('R55: an awaiting_deposit booking holds its seats (the last seats are refused) and its deposit row comes with it', () => {
    const rid = restaurant()
    const held = insertAwaiting(rid, 'hold-A', { party: 8 })
    expect(held.ok).toBe(true)
    expect(held.row?.status).toBe('awaiting_deposit')
    expect(held.deposit?.status).toBe('awaiting')
    expect(guests(rid)).toEqual({ [DAY]: { '19:00': 8 } })
    expect(insertPending(rid, 'late-B', { phone: '+85291110000', party: 4 })).toEqual({
      ok: false, refusal: { kind: 'full', scope: 'slot', guests: 8, limit: 10 },
    })
    expect(events(held.deposit!.id)).toBe('created:system')
  })

  it('R55: a 4th awaiting/pending request for one phone is refused (pending_cap), other phones are not', () => {
    const rid = restaurant()
    const phone = '+85291230001'
    expect(insertAwaiting(rid, 'cap-1', { phone, party: 1 }).ok).toBe(true)
    expect(insertPending(rid, 'cap-2', { phone, party: 1 }).ok).toBe(true)
    expect(insertAwaiting(rid, 'cap-3', { phone, party: 1 }).ok).toBe(true)
    expect(insertAwaiting(rid, 'cap-4', { phone, party: 1 })).toEqual({ ok: false, refusal: { kind: 'pending_cap' } })
    expect(insertPending(rid, 'cap-5', { phone, party: 1 })).toEqual({ ok: false, refusal: { kind: 'pending_cap' } })
    expect(insertPending(rid, 'other', { phone: '+85291230002', party: 1 }).ok).toBe(true)
  })

  it('R55: the PAP promotion counts awaiting_deposit toward its pending cap', () => {
    const rid = restaurant()
    const phone = '+85291230003'
    for (const n of [1, 2, 3]) expect(insertAwaiting(rid, `pap-${n}`, { phone, party: 1 }).ok).toBe(true)
    psql(
      `INSERT INTO booking_requests (restaurant_id, phone, name, party_size, booking_date, booking_time, source, status, confirm_code, verify_expires_at)
       VALUES ('${rid}', '${phone}', 'pap', 1, '${DAY}', '20:00', 'agent', 'unverified', 'K7PX3M', now() + interval '30 minutes')`
    )
    const promoted = psql(asService(`SELECT count(*) FROM public.promote_agent_booking_with_room('${rid}', '${phone}', ARRAY['K7PX3M'], 'w', now(), 3, '{}'::jsonb)`))
    expect(promoted).toBe('0')
    expect(psql(asService(`SELECT count(*) FROM public.promote_agent_booking('${rid}', '${phone}', ARRAY['K7PX3M'], 'w', now(), 3)`))).toBe('0')
  })

  it('R55: the expiry RPC lapses only expired awaiting rows, frees their seats, and leaves live and paid ones', () => {
    const rid = restaurant()
    const expired = insertAwaiting(rid, 'exp-A', { phone: '+85291000001', party: 3 })
    const live = insertAwaiting(rid, 'live-B', { phone: '+85291000002', party: 2 })
    const paidOne = insertAwaiting(rid, 'paid-C', { phone: '+85291000003', party: 1 })
    expire(expired.deposit!.id)
    expect(paid(paidOne.deposit!.id).outcome).toBe('paid')
    expire(paidOne.deposit!.id)
    expect(guests(rid)).toEqual({ [DAY]: { '19:00': 6 } })

    expect(lapse()).toBe(expired.deposit!.id)
    expect(statusOf(expired.row!.id)).toBe('lapsed')
    expect(depositStatus(expired.deposit!.id)).toBe('lapsed')
    expect(statusOf(live.row!.id)).toBe('awaiting_deposit')
    expect(statusOf(paidOne.row!.id)).toBe('pending')
    expect(guests(rid)).toEqual({ [DAY]: { '19:00': 3 } })
    expect(events(expired.deposit!.id)).toBe('created:system,lapsed:cron')
    expect(lapse()).toBe('')
  })

  it('R55: the expiry RPC uses the database clock and its limit; a deposit id narrows it', () => {
    const rid = restaurant()
    const a = insertAwaiting(rid, 'lim-A', { phone: '+85291000011', party: 1 })
    const b = insertAwaiting(rid, 'lim-B', { phone: '+85291000012', party: 1 })
    expire(a.deposit!.id)
    expire(b.deposit!.id)
    expect(lapse(200, b.deposit!.id)).toBe(b.deposit!.id)
    expect(depositStatus(a.deposit!.id)).toBe('awaiting')
    expect(lapse(1)).toBe(a.deposit!.id)
  })

  it('R57: paid first, then the expiry step: the lapse changes nothing', () => {
    const rid = restaurant()
    const held = insertAwaiting(rid, 'race-paid')
    const result = paid(held.deposit!.id)
    expect(result.outcome).toBe('paid')
    expect(result.booking?.status).toBe('pending')
    expire(held.deposit!.id)
    expect(lapse()).toBe('')
    expect(statusOf(held.row!.id)).toBe('pending')
    expect(depositStatus(held.deposit!.id)).toBe('paid')
    expect(events(held.deposit!.id)).toBe('created:system,paid:provider')
  })

  it('R57: lapse first, then the payment: the booking stays lapsed and the deposit goes to refund (late_payment), once', () => {
    const rid = restaurant()
    const held = insertAwaiting(rid, 'race-late')
    expire(held.deposit!.id)
    expect(lapse()).toBe(held.deposit!.id)
    const late = paid(held.deposit!.id)
    expect(late.outcome).toBe('late')
    expect(late.deposit).toMatchObject({ status: 'refund_pending', refund_reason: 'late_payment', refund_attempts: 1 })
    expect(statusOf(held.row!.id)).toBe('lapsed')
    expect(paid(held.deposit!.id).outcome).toBe('duplicate')
    expect(events(held.deposit!.id)).toBe('created:system,lapsed:cron,late_payment:provider,refund_requested:system')
  })

  it('R57: a payment holding the deposit row lock makes a concurrent expiry step skip it (the loser changes nothing)', async () => {
    const rid = restaurant()
    const held = insertAwaiting(rid, 'race-lock')
    expire(held.deposit!.id)
    const holder = psqlAsync(
      `BEGIN; SET ROLE service_role; SELECT public.mark_booking_deposit_paid('${held.deposit!.id}', 'pay_lock', now()); SELECT pg_sleep(1.5); COMMIT;`
    )
    await new Promise((r) => setTimeout(r, 400))
    const lapsedWhileHeld = await psqlAsync(asService(`SELECT count(*) FROM public.lapse_expired_booking_deposits(200)`))
    const first = await holder
    console.log(`[R57 race] paid=${first.replace(/\n/g, ' ').slice(0, 60)} | lapsed while held=${lapsedWhileHeld}`)
    expect(lapsedWhileHeld).toBe('0')
    expect(statusOf(held.row!.id)).toBe('pending')
    expect(depositStatus(held.deposit!.id)).toBe('paid')
  })

  it('R57: 10 concurrent paid + lapse calls on one expired hold end in exactly one consistent state', async () => {
    const rid = restaurant()
    const held = insertAwaiting(rid, 'race-fuzz')
    expire(held.deposit!.id)
    const calls = Array.from({ length: 10 }, (_, i) =>
      psqlAsync(
        asService(
          i % 2 === 0
            ? `SELECT public.mark_booking_deposit_paid('${held.deposit!.id}', 'pay_fuzz', now()) ->> 'outcome'`
            : `SELECT count(*) FROM public.lapse_expired_booking_deposits(200)`
        )
      )
    )
    const results = await Promise.all(calls)
    const booking = statusOf(held.row!.id)
    const dep = depositStatus(held.deposit!.id)
    console.log(`[R57 fuzz] ${results.join(' ')} -> booking ${booking}, deposit ${dep}`)
    expect([`pending/paid`, `lapsed/refund_pending`]).toContain(`${booking}/${dep}`)
    expect(results.filter((r) => r === 'paid' || r === 'late')).toHaveLength(1)
  })

  it('staff-created awaiting booking becomes confirmed on payment, decided by its creator', () => {
    const rid = restaurant()
    const staff = randomUUID()
    const held = insertAwaiting(rid, 'staff-hold')
    psql(`UPDATE booking_requests SET source = 'staff', created_by = '${staff}' WHERE id = '${held.row!.id}'`)
    expect(paid(held.deposit!.id).booking?.status).toBe('confirmed')
    expect(psql(`SELECT decided_by || ',' || (decided_at IS NOT NULL) FROM booking_requests WHERE id = '${held.row!.id}'`)).toBe(`${staff},true`)
  })

  it('review finding 6: a staff deposit booking records created_by through insert_booking_request_if_room, and payment decides by it', () => {
    const rid = restaurant()
    const staff = randomUUID()
    const held = insertAwaiting(rid, 'staff-made', { source: 'staff', createdBy: staff })
    expect(held.ok).toBe(true)
    expect(psql(`SELECT created_by FROM booking_requests WHERE id = '${held.row!.id}'`)).toBe(staff)
    expect(paid(held.deposit!.id).booking?.status).toBe('confirmed')
    expect(psql(`SELECT decided_by FROM booking_requests WHERE id = '${held.row!.id}'`)).toBe(staff)
  })

  it('096 + 097: a staff deposit booking with no phone is never capped and never messaged; a diner row still needs a phone', () => {
    const rid = restaurant()
    const staff = randomUUID()
    for (const n of [1, 2, 3, 4]) {
      const held = insertAwaiting(rid, `walk-in-${n}`, { phone: null, source: 'staff', createdBy: staff, party: 1, maxPending: 3 })
      expect(held.ok, `walk-in ${n}`).toBe(true)
      expect(psql(`SELECT coalesce(phone, '-') || ',' || notify_diner FROM booking_requests WHERE id = '${held.row!.id}'`)).toBe('-,false')
    }
    expect(error(asService(
      `SELECT public.insert_booking_request_if_room('${row(rid, 'diner-no-phone', { phone: null })}'::jsonb, '晚市', '18:00', '21:30', 10, NULL, 'awaiting_deposit', '${deposit(rid)}'::jsonb, 3)`
    ))).toContain('booking_requests_phone_staff_only')
  })

  it('R54: abandon lapses the booking and its hold at once (seats freed), event session_failed', () => {
    const rid = restaurant()
    const held = insertAwaiting(rid, 'abandon', { party: 6 })
    expect(psql(asService(`SELECT count(*) FROM public.abandon_booking_deposit('${held.deposit!.id}')`))).toBe('1')
    expect(statusOf(held.row!.id)).toBe('lapsed')
    expect(guests(rid)).toEqual({})
    expect(events(held.deposit!.id)).toBe('created:system,session_failed:system')
  })

  it('session attach stores the id once, with its event', () => {
    const rid = restaurant()
    const held = insertAwaiting(rid, 'attach')
    const attach = (id: string) =>
      psql(asService(`SELECT count(*) FROM public.booking_deposit_attach_session('${held.deposit!.id}', '${id}', 'https://pay.test.invalid/s/${id}')`))
    expect(attach('cs_1')).toBe('1')
    expect(attach('cs_2')).toBe('0')
    expect(psql(`SELECT provider_session_id FROM booking_deposits WHERE id = '${held.deposit!.id}'`)).toBe('cs_1')
    expect(events(held.deposit!.id)).toBe('created:system,session_created:system')
  })

  describe('R56 / R58 refund and keep CAS', () => {
    const begin = (dep: string, rid: string, from = 'paid', statuses = "ARRAY['declined','cancelled','no_show']", actor = randomUUID()) =>
      psql(
        asService(
          `SELECT coalesce(string_agg(refund_attempts::text, ','), '') FROM public.begin_booking_deposit_refund('${dep}', '${rid}', '${from}', 'staff', ${statuses}, 'user', '${actor}', now())`
        )
      )
    const finish = (dep: string, attempt: number | null, outcome: string, ref: string | null) =>
      psql(asService(`SELECT count(*) FROM public.finish_booking_deposit_refund('${dep}', ${attempt ?? 'NULL'}, '${outcome}', ${ref ? `'${ref}'` : 'NULL'}, 'provider')`))
    const keep = (dep: string, rid: string) =>
      psql(asService(`SELECT count(*) FROM public.keep_booking_deposit('${dep}', '${rid}', ARRAY['cancelled','no_show'], '${randomUUID()}', now())`))
    const cancel = (bookingId: string) =>
      psql(`UPDATE booking_requests SET status = 'cancelled', cancelled_at = now(), cancelled_by = 'staff' WHERE id = '${bookingId}'`)

    function paidCancelled(rid: string, name: string) {
      const held = insertAwaiting(rid, name, { phone: `+8529${Math.floor(1e7 + Math.random() * 8e7)}`, party: 1 })
      paid(held.deposit!.id)
      psql(`UPDATE booking_requests SET status = 'confirmed', decided_at = now() WHERE id = '${held.row!.id}'`)
      cancel(held.row!.id)
      return held
    }

    it('two concurrent Refund calls: exactly one wins (attempt 1)', async () => {
      const rid = restaurant()
      const held = paidCancelled(rid, 'refund-race')
      const sql = asService(
        `SELECT count(*) FROM public.begin_booking_deposit_refund('${held.deposit!.id}', '${rid}', 'paid', 'staff', ARRAY['cancelled'], 'user', '${randomUUID()}', now())`
      )
      const results = await Promise.all([psqlAsync(sql), psqlAsync(sql), psqlAsync(sql)])
      expect(results.sort()).toEqual(['0', '0', '1'])
      expect(psql(`SELECT status || ',' || refund_attempts FROM booking_deposits WHERE id = '${held.deposit!.id}'`)).toBe('refund_pending,1')
    })

    it('Refund after Keep and Keep after Refund change nothing; a foreign restaurant changes nothing', () => {
      const rid = restaurant()
      const other = restaurant()
      const kept = paidCancelled(rid, 'kept')
      expect(begin(kept.deposit!.id, other)).toBe('')
      expect(keep(kept.deposit!.id, other)).toBe('0')
      expect(keep(kept.deposit!.id, rid)).toBe('1')
      expect(begin(kept.deposit!.id, rid)).toBe('')
      expect(depositStatus(kept.deposit!.id)).toBe('kept')

      const refunded = paidCancelled(rid, 'refunded')
      expect(begin(refunded.deposit!.id, rid)).toBe('1')
      expect(keep(refunded.deposit!.id, rid)).toBe('0')
    })

    it('a paid deposit on a still-pending booking cannot be refunded or kept by staff', () => {
      const rid = restaurant()
      const held = insertAwaiting(rid, 'still-pending')
      paid(held.deposit!.id)
      expect(begin(held.deposit!.id, rid)).toBe('')
      expect(keep(held.deposit!.id, rid)).toBe('0')
    })

    it('refund_pending -> refund_failed -> Retry (attempt 2) -> refunded; a stale refund id from attempt 1 changes nothing', () => {
      const rid = restaurant()
      const actor = randomUUID()
      const held = paidCancelled(rid, 'retry')
      expect(begin(held.deposit!.id, rid, 'paid', "ARRAY['cancelled']", actor)).toBe('1')
      expect(finish(held.deposit!.id, 1, 'refund_failed', 're_1')).toBe('1')
      expect(begin(held.deposit!.id, rid, 'refund_failed')).toBe('2')
      psql(asService(`SELECT public.record_booking_deposit_refund_ref('${held.deposit!.id}', 2, 're_2')`))
      expect(finish(held.deposit!.id, null, 'refund_failed', 're_1')).toBe('0')
      expect(finish(held.deposit!.id, 1, 'refunded', null)).toBe('0')
      expect(finish(held.deposit!.id, null, 'refunded', 're_2')).toBe('1')
      expect(depositStatus(held.deposit!.id)).toBe('refunded')
      expect(psql(`SELECT refund_reason || ',' || decided_by FROM booking_deposits WHERE id = '${held.deposit!.id}'`)).toBe(`staff,${actor}`)
      expect(events(held.deposit!.id)).toBe(
        'created:system,paid:provider,refund_requested:user,refund_failed:provider,refund_requested:user,refund_succeeded:provider'
      )
      expect(psql(`SELECT count(*) FROM deposit_events WHERE deposit_id = '${held.deposit!.id}' AND event_type = 'refund_requested' AND actor_user_id = '${actor}'`)).toBe('1')
    })

    const record = (dep: string, attempt: number, ref: string) =>
      psql(asService(`SELECT public.record_booking_deposit_refund_ref('${dep}', ${attempt}, '${ref}')`))
    const attempts = (dep: string) =>
      psql(`SELECT coalesce(string_agg(attempt || '=' || coalesce(refund_ref, '-'), ',' ORDER BY attempt), '') FROM booking_deposit_refund_attempts WHERE deposit_id = '${dep}'`)
    const state = (dep: string) => psql(`SELECT status || ',' || refund_attempts || ',' || coalesce(refund_ref, '-') FROM booking_deposits WHERE id = '${dep}'`)

    it('finding 2: attempt 1 re_1 failed, Retry -> attempt 2 with no id yet; a delayed failed/canceled for re_1 changes nothing; attempt 2 settles', () => {
      const rid = restaurant()
      const held = paidCancelled(rid, 'attempt-match')
      const dep = held.deposit!.id
      expect(begin(dep, rid, 'paid', "ARRAY['cancelled']")).toBe('1')
      record(dep, 1, 're_1')
      expect(finish(dep, 1, 'refund_failed', 're_1')).toBe('1')
      expect(begin(dep, rid, 'refund_failed')).toBe('2')
      expect(state(dep)).toBe('refund_pending,2,-')
      expect(attempts(dep)).toBe('1=re_1,2=-')

      expect(finish(dep, null, 'refund_failed', 're_1')).toBe('0')
      expect(finish(dep, null, 'refunded', 're_unknown')).toBe('0')
      expect(finish(dep, null, 'refund_failed', null)).toBe('0')
      expect(state(dep)).toBe('refund_pending,2,-')

      record(dep, 2, 're_2')
      expect(state(dep)).toBe('refund_pending,2,re_2')
      expect(finish(dep, null, 'refunded', 're_2')).toBe('1')
      expect(state(dep)).toBe('refunded,2,re_2')
      expect(attempts(dep)).toBe('1=re_1,2=re_2')
    })

    it('finding 2: an older attempt’s id that succeeds -> refunded (from refund_pending), and no Retry can start after it', () => {
      const rid = restaurant()
      const held = paidCancelled(rid, 'older-success')
      const dep = held.deposit!.id
      expect(begin(dep, rid, 'paid', "ARRAY['cancelled']")).toBe('1')
      expect(finish(dep, 1, 'refund_failed', 're_1')).toBe('1')
      expect(begin(dep, rid, 'refund_failed')).toBe('2')
      record(dep, 2, 're_2')
      expect(finish(dep, null, 'refunded', 're_1')).toBe('1')
      expect(state(dep)).toBe('refunded,2,re_1')
      expect(finish(dep, 2, 'refunded', 're_2')).toBe('0')
      expect(finish(dep, null, 'refund_failed', 're_2')).toBe('0')
      expect(begin(dep, rid, 'refund_failed')).toBe('')
      expect(depositStatus(dep)).toBe('refunded')
    })

    it('finding 2: ids are noted once per attempt and once per deposit; an unclaimed attempt is never created; "fully refunded" with no id ends refund_failed', () => {
      const rid = restaurant()
      const held = paidCancelled(rid, 'note-once')
      const dep = held.deposit!.id
      expect(begin(dep, rid, 'paid', "ARRAY['cancelled']")).toBe('1')
      record(dep, 1, 're_1')
      record(dep, 1, 're_other')
      record(dep, 3, 're_3')
      expect(attempts(dep)).toBe('1=re_1')
      expect(state(dep)).toBe('refund_pending,1,re_1')
      expect(finish(dep, 1, 'refund_failed', 're_1')).toBe('1')
      expect(finish(dep, null, 'refunded', null)).toBe('1')
      expect(depositStatus(dep)).toBe('refunded')
    })

    it('finding 1: the late-payment refund claims attempt 1; the stalled list returns only refund_pending rows with no id older than the cutoff', () => {
      const rid = restaurant()
      const late = insertAwaiting(rid, 'late', { phone: '+85291230011' })
      expire(late.deposit!.id)
      lapse(200, late.deposit!.id)
      expect(paid(late.deposit!.id).outcome).toBe('late')
      expect(attempts(late.deposit!.id)).toBe('1=-')
      expect(paid(late.deposit!.id).outcome).toBe('duplicate')
      expect(state(late.deposit!.id)).toBe('refund_pending,1,-')

      const fresh = paidCancelled(rid, 'fresh')
      expect(begin(fresh.deposit!.id, rid, 'paid', "ARRAY['cancelled']")).toBe('1')
      const withRef = paidCancelled(rid, 'with-ref')
      expect(begin(withRef.deposit!.id, rid, 'paid', "ARRAY['cancelled']")).toBe('1')
      record(withRef.deposit!.id, 1, 're_w')
      psql(`UPDATE booking_deposits SET updated_at = now() - interval '11 minutes' WHERE id IN ('${late.deposit!.id}', '${withRef.deposit!.id}')`)
      const stalled = psql(
        asService(`SELECT coalesce(string_agg(id::text, ','), '') FROM public.stalled_booking_deposit_refunds(50, 600) WHERE restaurant_id = '${rid}'`)
      )
      expect(stalled).toBe(late.deposit!.id)
    })
  })

  it('shape: a deposit only with awaiting_deposit, no unknown deposit keys, no other status; amount > 0', () => {
    const rid = restaurant()
    const q = (status: string, dep: string) =>
      asService(`SELECT public.insert_booking_request_if_room('${row(rid, 'shape')}'::jsonb, NULL, NULL, NULL, NULL, NULL, '${status}', ${dep}, NULL)`)
    expect(error(q('awaiting_deposit', 'NULL'))).toContain('a deposit is required exactly for awaiting_deposit')
    expect(error(q('pending', `'${deposit(rid)}'::jsonb`))).toContain('a deposit is required exactly for awaiting_deposit')
    expect(error(q('confirmed', 'NULL'))).toContain('status confirmed is not allowed')
    expect(error(q('awaiting_deposit', `'${deposit(rid, { status: 'paid' })}'::jsonb`))).toContain('deposit key status is not allowed')
    expect(error(q('awaiting_deposit', `'${deposit(rid, { amount_minor: 0 })}'::jsonb`))).toContain('booking_deposits_amount_minor_check')
    expect(Number(psql(`SELECT count(*) FROM booking_requests WHERE restaurant_id = '${rid}'`))).toBe(0)
  })

  it('R60: deposit_events is append-only (UPDATE refused, even for the table owner)', () => {
    const rid = restaurant()
    const held = insertAwaiting(rid, 'audit')
    expect(error(`UPDATE deposit_events SET actor_kind = 'cron' WHERE deposit_id = '${held.deposit!.id}'`)).toContain('append-only')
    expect(error(`SET ROLE service_role; DELETE FROM deposit_events WHERE deposit_id = '${held.deposit!.id}'`)).toContain('permission denied')
  })

  it('a booking with a deposit cannot be deleted on its own (purges never orphan money); the restaurant cascade removes both', () => {
    const rid = restaurant()
    const held = insertAwaiting(rid, 'fk')
    expect(error(`DELETE FROM booking_requests WHERE id = '${held.row!.id}'`)).toContain('booking_deposits_booking_id_fkey')
  })

  it('R58: anon and authenticated cannot execute any 097 function and read no deposit rows', () => {
    const rid = restaurant()
    insertAwaiting(rid, 'grants')
    const id = randomUUID()
    const fns = [
      `SELECT public.insert_booking_request_if_room('{}'::jsonb, NULL, NULL, NULL, NULL, NULL, 'pending', NULL, NULL)`,
      `SELECT * FROM public.lapse_expired_booking_deposits(1)`,
      `SELECT * FROM public.abandon_booking_deposit('${id}')`,
      `SELECT public.mark_booking_deposit_paid('${id}', 'p', now())`,
      `SELECT * FROM public.booking_deposit_attach_session('${id}', 's', 'https://x')`,
      `SELECT * FROM public.begin_booking_deposit_refund('${id}', '${id}', 'paid', 'staff', ARRAY['cancelled'], 'user', '${id}', now())`,
      `SELECT * FROM public.finish_booking_deposit_refund('${id}', 1, 'refunded', NULL, 'provider')`,
      `SELECT public.record_booking_deposit_refund_ref('${id}', 1, 're_x')`,
      `SELECT * FROM public.stalled_booking_deposit_refunds(1, 600)`,
      `SELECT * FROM public.keep_booking_deposit('${id}', '${id}', ARRAY['cancelled'], '${id}', now())`,
    ]
    for (const role of ['anon', 'authenticated']) {
      for (const fn of fns) expect(error(`SET ROLE ${role}; ${fn}`), `${role}: ${fn}`).toContain('permission denied for function')
      for (const table of ['booking_deposits', 'deposit_events', 'merchant_payment_accounts', 'booking_deposit_refund_attempts']) {
        const out = error(`SET ROLE ${role}; SELECT count(*) FROM ${table}`)
        expect(out === '' ? psql(`SET ROLE ${role}; SELECT count(*) FROM ${table}`) : 'denied').not.toBe('1')
      }
    }
  })

  it('merchant_payment_accounts: one per provider per restaurant; a provider account links to one restaurant; active needs charges', () => {
    const a = restaurant()
    const b = restaurant()
    psql(`INSERT INTO merchant_payment_accounts (restaurant_id, provider_code, provider_account_id) VALUES ('${a}', 'stripe', 'acct_A')`)
    expect(error(`INSERT INTO merchant_payment_accounts (restaurant_id, provider_code, provider_account_id) VALUES ('${a}', 'stripe', 'acct_A2')`)).toContain(
      'merchant_payment_accounts_one_per_provider'
    )
    expect(error(`INSERT INTO merchant_payment_accounts (restaurant_id, provider_code, provider_account_id) VALUES ('${b}', 'stripe', 'acct_A')`)).toContain(
      'merchant_payment_accounts_provider_account_once'
    )
    expect(error(`UPDATE merchant_payment_accounts SET status = 'active' WHERE restaurant_id = '${a}'`)).toContain('merchant_payment_accounts_active_ready')
  })
})
