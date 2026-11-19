// BOOK-003: the public agent API through its routes, with in-memory ports.
// R33 tenant from path · R34 body rules · R36 status token · R37 logs ·
// R38 headers · R39 caps · R40 Poppy-Session ignored · R42 one row only ·
// R43 off/rotated/mode · R44 collection statement · R46 Idempotency-Key.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { FakeBookingSettings } from '@/test-utils/fake-booking'
import { FakeRateLimiter } from '@/test-utils/fake-rate-limiter'
import { FakeClock } from '@/test-utils/fake-clock'
import { FakeAgentBookingStore, FakeAgentDirectory, scriptedSecrets } from '@/application/booking/__tests__/fake-agent-booking'
import type { CreateAgentBookingDeps } from '@/application/booking/create-agent-booking'
import type { GetAgentBookingStatusDeps } from '@/application/booking/get-agent-booking-status'

const holder: { create: CreateAgentBookingDeps | null; status: GetAgentBookingStatusDeps | null; openapi: unknown } = {
  create: null,
  status: null,
  openapi: null,
}
vi.mock('@/application/booking/booking-deps', () => ({
  createAgentBookingDeps: () => holder.create,
  getAgentBookingStatusDeps: () => holder.status,
  agentOpenApiDeps: () => holder.openapi,
}))

import { POST } from '../[publicId]/bookings/route'
import { GET as GET_STATUS } from '../[publicId]/bookings/[id]/route'
import { GET as GET_OPENAPI } from '../[publicId]/openapi.json/route'

const A = 'rest-a'
const B = 'rest-b'
const PID_A = 'A'.repeat(32)
const PID_B = 'B'.repeat(32)
const PHONE = '+85291234567'
const BODY = { date: '2026-11-20', time: '19:30', party_size: 4, name: 'Chan Tai Man', phone: PHONE, notes: 'window' }
const PRIVACY = 'https://ohmyclient.io/privacy-policy.html'

let store: FakeAgentBookingStore
let directory: FakeAgentDirectory
let settings: FakeBookingSettings
let clock: FakeClock

beforeEach(() => {
  clock = new FakeClock(new Date('2026-11-19T02:00:00.000Z'))
  store = new FakeAgentBookingStore()
  store.createdAt = () => clock.now()
  directory = new FakeAgentDirectory()
  directory.add(A, PID_A)
  directory.add(B, PID_B)
  settings = new FakeBookingSettings()
  settings.restaurants.set(A, { name: 'Cafe A', logoUrl: null, whatsappNumber: '+85230001111' })
  settings.restaurants.set(B, { name: 'Cafe B', logoUrl: null, whatsappNumber: '+85230002222' })
  holder.create = {
    directory, store, settings, limiter: new FakeRateLimiter(clock), secrets: scriptedSecrets(['K7PX3M', 'Q2W3E4', 'Z9Y8X7']),
    privacyUrl: PRIVACY, now: () => clock.now(),
  }
  holder.status = { directory, store, now: () => clock.now() }
  holder.openapi = { directory, settings, appUrl: 'https://app.ohmyclient.io', privacyUrl: PRIVACY }
})
afterEach(() => vi.restoreAllMocks())

function post(body: unknown, opts: { pid?: string; headers?: Record<string, string>; raw?: string; ip?: string } = {}) {
  const pid = opts.pid ?? PID_A
  const req = new NextRequest(`https://app.ohmyclient.io/api/poppy/${pid}/bookings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-real-ip': opts.ip ?? '203.0.113.9', ...opts.headers },
    body: opts.raw ?? JSON.stringify(body),
  })
  return POST(req, { params: Promise.resolve({ publicId: pid }) })
}

function getStatus(id: string, token: string | null, pid = PID_A) {
  const headers: Record<string, string> = token === null ? {} : { 'X-Booking-Status-Token': token }
  const req = new NextRequest(`https://app.ohmyclient.io/api/poppy/${pid}/bookings/${id}`, { headers })
  return GET_STATUS(req, { params: Promise.resolve({ publicId: pid, id }) })
}

function expectAgentHeaders(res: Response) {
  expect(res.headers.get('Cache-Control')).toContain('no-store')
  expect(res.headers.get('Referrer-Policy')).toBe('no-referrer')
  expect(res.headers.get('Content-Type')).toContain('application/json')
}

describe('POST /api/poppy/{publicId}/bookings', () => {
  it('AC-3: 202 with every field, one unverified agent row, nothing sent on WhatsApp (R42)', async () => {
    const res = await post(BODY)
    expect(res.status).toBe(202)
    const body = await res.json()
    expect(Object.keys(body).sort()).toEqual(
      ['booking_id', 'collection_statement', 'confirm_code', 'confirm_url', 'expires_at', 'status', 'status_token'].sort()
    )
    expect(body).toMatchObject({ status: 'awaiting_confirmation', confirm_code: 'K7PX3M', expires_at: '2026-11-19T02:30:00.000Z' })
    const url = new URL(body.confirm_url)
    expect(`${url.origin}${url.pathname}`).toBe('https://wa.me/85230001111')
    expect(url.searchParams.get('text')).toBe('確認Cafe A訂座 Confirm my booking at Cafe A: K7PX3M')
    expect(body.status_token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(store.rows).toHaveLength(1)
    expect(store.rows[0]).toMatchObject({
      restaurantId: A, status: 'unverified', source: 'agent', phone: PHONE, memberId: null, confirmCode: 'K7PX3M',
      partySize: 4, bookingDate: '2026-11-20', bookingTime: '19:30', name: 'Chan Tai Man', notes: 'window',
    })
    expect(store.rows[0].statusTokenHash).toMatch(/^[0-9a-f]{64}$/)
    expect(store.rows[0].statusTokenHash).not.toContain(body.status_token)
    // R42: the create deps carry no message sender, member lookup or consent store at all.
    expect(Object.keys(holder.create!).sort()).toEqual(['directory', 'limiter', 'now', 'privacyUrl', 'secrets', 'settings', 'store'])
    expect(store.calls.filter((c) => !['countLiveUnverified', 'countPending', 'insert'].includes(c))).toEqual([])
    expectAgentHeaders(res)
  })

  it('R44: the response carries the collection statement in en and zh-HK with the privacy link', async () => {
    const body = await (await post(BODY)).json()
    expect(body.collection_statement).toEqual({
      en: expect.stringContaining('go only to Cafe A, to handle this booking'),
      'zh-HK': expect.stringContaining('只會交給Cafe A'),
      privacy_url: PRIVACY,
    })
    expect(body.collection_statement.en).toContain('phone number')
  })

  it('R33: a restaurant_id (or slug) in the body is an unknown field → 400; the booking lands only on the path tenant', async () => {
    for (const extra of [{ restaurant_id: B }, { restaurantId: B }, { slug: 'cafe-b' }, { token: 'x' }]) {
      const res = await post({ ...BODY, ...extra })
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toBe('invalid_request')
      expect(Object.values(body.fields)).toContain('unknown_field')
    }
    expect(store.rows).toHaveLength(0)
    await post(BODY, { pid: PID_B })
    expect(store.rows.map((r) => r.restaurantId)).toEqual([B])
  })

  it.each([
    ['past date', { date: '2026-11-18' }, 'date', 'past'],
    ['bad date', { date: '2026-02-30' }, 'date', 'invalid'],
    ['bad time', { time: '25:00' }, 'time', 'invalid'],
    ['time already past today', { date: '2026-11-19', time: '09:00' }, 'time', 'past_time'],
    ['party 0', { party_size: 0 }, 'party_size', 'too_small'],
    ['party over max', { party_size: 21 }, 'party_size', 'too_large'],
    ['party not integer', { party_size: 2.5 }, 'party_size', 'invalid'],
    ['name too long', { name: 'x'.repeat(61) }, 'name', 'too_long'],
    ['name missing', { name: '' }, 'name', 'required'],
    ['notes too long', { notes: 'x'.repeat(501) }, 'notes', 'too_long'],
    ['phone missing', { phone: undefined }, 'phone', 'required'],
    ['phone not E.164', { phone: '91234567' }, 'phone', 'invalid'],
    ['phone with letters', { phone: '+852ABC4567' }, 'phone', 'invalid'],
    ['unknown field', { partySize: 4 }, 'partySize', 'unknown_field'],
  ])('R34: %s → 400 invalid_request with the field, no row', async (_label, patch, field, code) => {
    const res = await post({ ...BODY, ...patch })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body).toMatchObject({ error: 'invalid_request', error_description: expect.any(String) })
    expect(body.fields[field]).toBe(code)
    expect(store.rows).toHaveLength(0)
    expectAgentHeaders(res)
  })

  it('R34: an international E.164 number is accepted', async () => {
    expect((await post({ ...BODY, phone: '+447911123456' })).status).toBe(202)
  })

  it('R34: a body that is not JSON → 400 invalid_request', async () => {
    const res = await post(null, { raw: 'not json' })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('invalid_request')
  })

  it('R43: disabled, rotated-away, unknown, malformed id or mode not simple → 404 not_found, no row', async () => {
    directory.add('rest-off', 'C'.repeat(32), {}, { enabled: false })
    directory.add('rest-ext', 'D'.repeat(32), { mode: 'external' })
    // Rotated: the index still points at the old id but the stored config moved on.
    directory.add('rest-rot', 'E'.repeat(32), {}, { publicId: 'F'.repeat(32) })
    for (const pid of ['C'.repeat(32), 'D'.repeat(32), 'E'.repeat(32), 'G'.repeat(32), 'short', '../etc']) {
      const res = await post(BODY, { pid })
      expect(res.status, pid).toBe(404)
      expect((await res.json()).error).toBe('not_found')
      expectAgentHeaders(res)
    }
    expect(store.rows).toHaveLength(0)
  })

  it('R43: a restaurant without a WhatsApp number cannot take agent bookings → 404', async () => {
    settings.restaurants.set(A, { name: 'Cafe A', logoUrl: null, whatsappNumber: null })
    expect((await post(BODY)).status).toBe(404)
  })

  it('R39: the 11th POST from one IP within a minute → 429 with Retry-After', async () => {
    for (let i = 0; i < 10; i++) await post(BODY, { pid: 'H'.repeat(32) })
    const res = await post(BODY, { pid: 'H'.repeat(32) })
    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe('60')
    expect((await res.json()).error).toBe('rate_limited')
    expectAgentHeaders(res)
  })

  it('R39: a 4th live unverified booking for one phone → 429; another phone still books', async () => {
    holder.create!.secrets = scriptedSecrets()
    for (let i = 0; i < 3; i++) expect((await post(BODY, { ip: `198.51.100.${i}` })).status).toBe(202)
    const res = await post(BODY, { ip: '198.51.100.9' })
    expect(res.status).toBe(429)
    expect(Number(res.headers.get('Retry-After'))).toBeGreaterThan(0)
    expect((await post({ ...BODY, phone: '+85290000000' }, { ip: '198.51.100.10' })).status).toBe(202)
  })

  it('R39: an expired unverified booking no longer counts toward the phone cap', async () => {
    holder.create!.secrets = scriptedSecrets()
    for (let i = 0; i < 3; i++) await post(BODY, { ip: `198.51.100.${i}` })
    clock.advanceMs(31 * 60_000)
    expect((await post(BODY, { ip: '198.51.100.20' })).status).toBe(202)
  })

  it('F1 (BOOK-001 R11): pending + live unverified for the phone at this restaurant >= 3 → 429, no insert', async () => {
    holder.create!.secrets = scriptedSecrets()
    store.seedPending(A, PHONE, 'chat')
    store.seedPending(A, PHONE, 'agent')
    expect((await post(BODY, { ip: '198.51.100.1' })).status).toBe(202)
    const inserts = store.calls.filter((c) => c === 'insert').length
    const res = await post(BODY, { ip: '198.51.100.2' })
    expect(res.status).toBe(429)
    expect(Number(res.headers.get('Retry-After'))).toBeGreaterThan(0)
    expect(store.calls.filter((c) => c === 'insert').length).toBe(inserts)
    // Pending at another restaurant or for another phone does not count.
    store.seedPending(B, '+85290000000', 'chat')
    expect((await post({ ...BODY, phone: '+85290000000' }, { ip: '198.51.100.3' })).status).toBe(202)
    expect((await post(BODY, { pid: PID_B, ip: '198.51.100.4' })).status).toBe(202)
  })

  it('F1 (BOOK-001 R11): three pending at this restaurant → 429 even with no unverified booking', async () => {
    for (let i = 0; i < 3; i++) store.seedPending(A, PHONE, 'chat')
    expect((await post(BODY)).status).toBe(429)
    expect(store.rows.filter((r) => r.status === 'unverified')).toEqual([])
  })

  it('R39: the 31st live unverified booking at one restaurant → 429', async () => {
    holder.create!.secrets = scriptedSecrets()
    for (let i = 0; i < 30; i++) {
      const phone = `+8529${String(1000000 + i)}`
      expect((await post({ ...BODY, phone }, { ip: `192.0.2.${i}` })).status).toBe(202)
    }
    const res = await post({ ...BODY, phone: '+85298888888' }, { ip: '192.0.2.200' })
    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).not.toBeNull()
  })

  it('R31: a code clash with a live unverified booking of the restaurant draws a new code', async () => {
    holder.create!.secrets = scriptedSecrets(['K7PX3M', 'K7PX3M', 'Q2W3E4'])
    await post(BODY)
    const second = await (await post({ ...BODY, phone: '+85290000000' })).json()
    expect(second.confirm_code).toBe('Q2W3E4')
    expect(store.rows.map((r) => r.confirmCode)).toEqual(['K7PX3M', 'Q2W3E4'])
  })

  it('R40: with, without and with a garbage Poppy-Session header the result is identical', async () => {
    const bodies = []
    const variants: Record<string, string>[] = [{}, { 'Poppy-Session': 'eyJ.garbage.sig', 'Poppy-Version': '1.0' }, { 'Poppy-Session': '' }]
    for (const headers of variants) {
      holder.create!.secrets = scriptedSecrets(['K7PX3M'])
      store.rows.length = 0
      const res = await post(BODY, { headers })
      const rest = await res.json()
      delete rest.booking_id
      bodies.push({ status: res.status, rest })
    }
    expect(bodies[1]).toEqual(bodies[0])
    expect(bodies[2]).toEqual(bodies[0])
  })

  it('R46: an Idempotency-Key replay returns the same booking and code, one row, a fresh token that replaces the old one', async () => {
    const headers = { 'Idempotency-Key': '4f1c2e8a-9b7d-4c3e-a5f6-0d8b1e2c3a4f' }
    const first = await (await post(BODY, { headers })).json()
    const res = await post(BODY, { headers })
    expect(res.status).toBe(202)
    const second = await res.json()
    expect(second.booking_id).toBe(first.booking_id)
    expect(second.confirm_code).toBe(first.confirm_code)
    expect(second.status_token).not.toBe(first.status_token)
    expect(store.rows).toHaveLength(1)
    expect((await getStatus(first.booking_id, first.status_token)).status).toBe(404)
    expect((await getStatus(first.booking_id, second.status_token)).status).toBe(200)
  })

  it('R46: the same key with a different body → 409 idempotency_conflict, no second row', async () => {
    const headers = { 'Idempotency-Key': 'key-1' }
    await post(BODY, { headers })
    const res = await post({ ...BODY, party_size: 5 }, { headers })
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ error: 'idempotency_conflict', error_description: expect.any(String) })
    expect(store.rows).toHaveLength(1)
  })

  it('R46: the same key at another restaurant is a separate booking', async () => {
    const headers = { 'Idempotency-Key': 'key-1' }
    await post(BODY, { headers })
    expect((await post(BODY, { headers, pid: PID_B })).status).toBe(202)
    expect(store.rows.map((r) => r.restaurantId)).toEqual([A, B])
  })

  it('R46: a replay after the diner confirmed returns the current status and a fresh token, no code', async () => {
    const headers = { 'Idempotency-Key': 'key-2' }
    const first = await (await post(BODY, { headers })).json()
    store.rows[0].status = 'pending'
    store.rows[0].confirmCode = null
    const res = await post(BODY, { headers })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ booking_id: first.booking_id, status: 'pending', status_token: expect.any(String) })
    expect(body).not.toHaveProperty('confirm_code')
  })

  it('R37: logs carry no phone, name, notes, code, status token or Poppy-Session on create and error paths', async () => {
    const logs: unknown[] = []
    for (const level of ['log', 'info', 'warn', 'error'] as const) {
      vi.spyOn(console, level).mockImplementation((...args) => void logs.push(args))
    }
    const session = 'eyJ0eXAiOiJwb3BweS1zZXNzaW9uK2p3dCJ9.secret-session.sig'
    const ok = await (await post(BODY, { headers: { 'Poppy-Session': session } })).json()
    holder.create!.store.insert = async () => {
      throw new Error(`insert failed for ${PHONE} Chan Tai Man`)
    }
    await post({ ...BODY, phone: '+85290000001' }, { headers: { 'Poppy-Session': session } })
    holder.create!.limiter.incrWindow = async () => {
      throw new Error(`redis down ${PHONE}`)
    }
    await post(BODY, { headers: { 'Poppy-Session': session } })
    const text = JSON.stringify(logs)
    expect(logs.length).toBeGreaterThan(0)
    for (const secret of [PHONE, '91234567', '+85290000001', 'Chan Tai Man', 'window', ok.confirm_code, ok.status_token, session]) {
      expect(text).not.toContain(secret)
    }
  })
})

describe('GET /api/poppy/{publicId}/bookings/{id}', () => {
  it('AC-3/R36: with the token → awaiting_confirmation and only status, date, time, party size, expiry', async () => {
    const created = await (await post(BODY)).json()
    const res = await getStatus(created.booking_id, created.status_token)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      booking_id: created.booking_id, status: 'awaiting_confirmation', date: '2026-11-20', time: '19:30', party_size: 4,
      expires_at: '2026-11-19T02:30:00.000Z',
    })
    expectAgentHeaders(res)
  })

  it('R36: no token, wrong token, another booking\'s token, malformed id → 404 with no phone or name', async () => {
    const one = await (await post(BODY)).json()
    const two = await (await post({ ...BODY, phone: '+85290000000' })).json()
    for (const [id, token] of [
      [one.booking_id, null],
      [one.booking_id, 'x'.repeat(43)],
      [one.booking_id, two.status_token],
      [one.booking_id, 'short'],
      ['not-a-uuid', one.status_token],
    ] as const) {
      const res = await getStatus(id, token)
      expect(res.status).toBe(404)
      const text = await res.text()
      expect(text).not.toContain(PHONE)
      expect(text).not.toContain('Chan')
      expectAgentHeaders(res)
    }
  })

  it('R36/R43: the right token through another restaurant\'s or a disabled id → 404', async () => {
    const created = await (await post(BODY)).json()
    expect((await getStatus(created.booking_id, created.status_token, PID_B)).status).toBe(404)
    directory.tenants.get(PID_A)!.config.agentBooking.enabled = false
    expect((await getStatus(created.booking_id, created.status_token)).status).toBe(404)
  })

  it('reports expired once the 30 minutes pass without the code, and no expires_at', async () => {
    const created = await (await post(BODY)).json()
    clock.advanceMs(30 * 60_000 + 1)
    const body = await (await getStatus(created.booking_id, created.status_token)).json()
    expect(body.status).toBe('expired')
    expect(body).not.toHaveProperty('expires_at')
  })
})

describe('GET /api/poppy/{publicId}/openapi.json', () => {
  it('R44: OpenAPI 3.1 for the tenant, server under its id, flow and collection statement in the description', async () => {
    const res = await GET_OPENAPI(new Request('https://x'), { params: Promise.resolve({ publicId: PID_A }) })
    expect(res.status).toBe(200)
    const doc = await res.json()
    expect(doc.openapi).toBe('3.1.0')
    expect(doc.servers).toEqual([{ url: `https://app.ohmyclient.io/api/poppy/${PID_A}` }])
    expect(Object.keys(doc.paths)).toEqual(['/bookings', '/bookings/{booking_id}'])
    expect(doc.info.description).toContain('THE SAME phone number')
    expect(doc.info.description).toContain('go only to Cafe A')
    expect(doc.info.description).toContain('只會交給Cafe A')
    expect(doc.info.description).toContain(PRIVACY)
    expect(doc.paths['/bookings'].post.requestBody.content['application/json'].schema.properties.party_size.maximum).toBe(20)
    expectAgentHeaders(res)
  })

  it('F6: without a usable NEXT_PUBLIC_APP_URL → 500 server_error, logged by error name only', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    holder.openapi = { directory, settings, appUrl: null, privacyUrl: PRIVACY }
    const res = await GET_OPENAPI(new Request('https://x'), { params: Promise.resolve({ publicId: PID_A }) })
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('server_error')
    expect(errors.mock.calls).toEqual([[expect.any(String), 'AgentAppUrlError']])
    expectAgentHeaders(res)
  })

  it('R43: 404 when agent booking is off', async () => {
    directory.add('rest-off', 'C'.repeat(32), {}, { enabled: false })
    const res = await GET_OPENAPI(new Request('https://x'), { params: Promise.resolve({ publicId: 'C'.repeat(32) }) })
    expect(res.status).toBe(404)
  })
})
