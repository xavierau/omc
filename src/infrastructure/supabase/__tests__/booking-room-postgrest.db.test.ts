/**
 * BOOK-010: one real-PostgREST smoke for migration 092 (memory: fakes hid
 * schema mismatch). The repositories run unmocked through supabase-js and a
 * real PostgREST over the scratch database, so RPC parameter names, the
 * jsonb row, time casts and the booking_stops columns are proven, not assumed.
 *
 *   scripts/book-010/scratch-db.sh up && scripts/book-010/scratch-db.sh rest
 *   RUN_DB_TESTS=1 BOOK010_POSTGREST_URL=http://127.0.0.1:55493 \
 *     BOOK010_POSTGREST_JWT_SECRET=<printed by the script> PGPORT=55492 PGUSER=postgres PGDATABASE=postgres \
 *     npx vitest run src/infrastructure/supabase/__tests__/booking-room-postgrest.db.test.ts
 *
 * supabase-js calls `<url>/rest/v1/...`; a local proxy strips that prefix
 * for the standalone PostgREST. The key is a service_role JWT signed with the
 * scratch-only secret.
 */
import { execFileSync } from 'node:child_process'
import { createHmac, randomUUID } from 'node:crypto'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  addBookingStop,
  insertBookingRequestIfRoom,
  readBookingRoom,
  removeBookingStop,
} from '@/infrastructure/supabase/repositories/booking-room-repository'
import { promoteAgentBooking } from '@/infrastructure/supabase/repositories/agent-booking-repository'
import type { NewBookingRequest } from '@/domain/entities/booking-request'

const REST = process.env.BOOK010_POSTGREST_URL
const SECRET = process.env.BOOK010_POSTGREST_JWT_SECRET
const d = process.env.RUN_DB_TESTS === '1' && REST && SECRET ? describe : describe.skip

const PG = ['-X', '-h', process.env.PGHOST ?? '127.0.0.1', '-p', process.env.PGPORT ?? '55492', '-U', process.env.PGUSER ?? 'postgres', '-d', process.env.PGDATABASE ?? 'postgres']
const psql = (sql: string) =>
  execFileSync('psql', [...PG, '-v', 'ON_ERROR_STOP=1', '-qtAc', sql], { env: { ...process.env, PGPASSWORD: process.env.PGPASSWORD ?? 'postgres' }, encoding: 'utf8' }).trim()

const b64 = (v: object | string) => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64url')
function serviceRoleJwt(secret: string): string {
  const head = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ role: 'service_role', exp: Math.floor(Date.now() / 1000) + 3600 })}`
  return `${head}.${createHmac('sha256', secret).update(head).digest('base64url')}`
}

const DAY = '2026-11-21'
const DINNER = { periodKey: '晚市', periodFirst: '18:00', periodLast: '21:30', perSlot: 30, perMeal: 60 }
let server: http.Server
let rid: string

function request(name: string, partySize = 4): NewBookingRequest {
  return {
    restaurantId: rid, memberId: null, phone: '+85291234567', name, partySize, bookingDate: DAY, bookingTime: '19:00',
    notes: null, source: 'agent', campaignId: null, token: null,
    termsAcceptedAt: '2026-11-20T02:00:00.000Z', termsText: '訂座須知',
  }
}

d('BOOK-010 repositories through a real PostgREST', () => {
  beforeAll(async () => {
    const target = new URL(REST as string)
    server = http.createServer((req, res) => {
      const path = (req.url ?? '/').replace(/^\/rest\/v1/, '')
      const upstream = http.request({ host: target.hostname, port: target.port, path, method: req.method, headers: { ...req.headers, host: target.host } }, (up) => {
        res.writeHead(up.statusCode ?? 502, up.headers)
        up.pipe(res)
      })
      req.pipe(upstream)
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    process.env.NEXT_PUBLIC_SUPABASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    process.env.SUPABASE_SERVICE_ROLE_KEY = serviceRoleJwt(SECRET as string)
    rid = randomUUID()
    psql(`INSERT INTO restaurants (id, name, slug, whatsapp_number) VALUES ('${rid}', 'BOOK-010 rest', 'book010-rest-${rid}', '+85230000000')`)
    psql(
      `INSERT INTO booking_requests (restaurant_id, phone, name, party_size, booking_date, booking_time, source, status, decided_at)
       VALUES ('${rid}', '+85290000000', 'seed', 24, '${DAY}', '19:00', 'chat', 'confirmed', now())`
    )
  })

  afterAll(async () => {
    if (rid) psql(`DELETE FROM restaurants WHERE id = '${rid}'`)
    await new Promise<void>((resolve) => server?.close(() => resolve()))
  })

  it('insertIfRoom writes the row (terms included) while it fits, then refuses full', async () => {
    const first = await insertBookingRequestIfRoom(request('rest-1'), DINNER)
    expect(first.ok && first.booking).toMatchObject({ restaurantId: rid, bookingTime: '19:00', partySize: 4, status: 'pending', source: 'agent' })
    expect(psql(`SELECT terms_text FROM booking_requests WHERE name = 'rest-1' AND restaurant_id = '${rid}'`)).toBe('訂座須知')
    expect(await insertBookingRequestIfRoom(request('rest-2'), DINNER)).toEqual({
      ok: false, refusal: { kind: 'full', scope: 'slot', guests: 28, limit: 30 },
    })
  })

  it('readRoom returns grouped counts and the stops; add is idempotent; remove deletes', async () => {
    const stop = { date: DAY, scope: 'period' as const, periodLabel: '晚市', time: null, stoppedById: null, stoppedByName: 'Amy', stoppedAt: '2026-11-20T06:02:00.000Z' }
    expect(await addBookingStop(rid, stop)).toMatchObject({ scope: 'period', periodLabel: '晚市', stoppedByName: 'Amy' })
    // F1 (review P3-3): a repeat answers with the stored row (Amy at 06:02), not the caller's.
    const again = await addBookingStop(rid, { ...stop, stoppedByName: 'Ben', stoppedAt: '2026-11-20T06:10:00.000Z' })
    expect(again).toMatchObject({ scope: 'period', periodLabel: '晚市', time: null, stoppedByName: 'Amy' })
    expect(Date.parse(again.stoppedAt)).toBe(Date.parse(stop.stoppedAt))
    await addBookingStop(rid, { ...stop, scope: 'slot', periodLabel: null, time: '12:30' })
    const room = await readBookingRoom(rid, '2026-11-01', '2026-11-30')
    expect(room.counts).toEqual({ [DAY]: { '19:00': 28 } })
    expect(room.stops).toHaveLength(2)
    expect(room.stops).toContainEqual({ ...stop, stoppedAt: expect.any(String) })
    expect(await insertBookingRequestIfRoom({ ...request('rest-3', 1), bookingTime: '20:00' }, DINNER)).toEqual({
      ok: false, refusal: { kind: 'stopped', scope: 'period' },
    })
    await removeBookingStop(rid, { date: DAY, scope: 'period', periodLabel: '晚市', time: null })
    await removeBookingStop(rid, { date: DAY, scope: 'slot', periodLabel: null, time: '12:30' })
    expect((await readBookingRoom(rid, DAY, DAY)).stops).toEqual([])
  })

  it('promote with room through the repository: a full candidate comes back declined "full"', async () => {
    const phone = '+85291113333'
    psql(
      `INSERT INTO booking_requests (restaurant_id, phone, name, party_size, booking_date, booking_time, source, status, confirm_code, verify_expires_at)
       VALUES ('${rid}', '${phone}', 'pap', 4, '${DAY}', '19:00', 'agent', 'unverified', 'K7PX3M', now() + interval '30 minutes')`
    )
    const rows = await promoteAgentBooking({
      restaurantId: rid, phone, codes: ['K7PX3M'], wamid: 'wamid.rest', at: new Date(), maxPending: 3, room: () => DINNER,
    })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ status: 'declined', declineReason: 'full', bookingTime: '19:00' })
  })
})
