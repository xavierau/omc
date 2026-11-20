// BOOK-007 R7: a no-show is a staff-only mark. The public poppy status read
// shows a no_show booking as `confirmed`, and the published status enum does
// not change (no new value in poppy.json / the OpenAPI document).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { FakeBookingSettings } from '@/test-utils/fake-booking'
import { FakeRateLimiter } from '@/test-utils/fake-rate-limiter'
import { FakeClock } from '@/test-utils/fake-clock'
import { FakeAgentBookingStore, FakeAgentDirectory, scriptedSecrets } from '@/application/booking/__tests__/fake-agent-booking'
import { agentBookingStatus } from '@/domain/services/agent-booking'
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
const PID = 'A'.repeat(32)
const PUBLISHED_STATUSES = ['awaiting_confirmation', 'expired', 'pending', 'confirmed', 'declined', 'cancelled']
let store: FakeAgentBookingStore

beforeEach(() => {
  const clock = new FakeClock(new Date('2026-11-19T02:00:00.000Z'))
  store = new FakeAgentBookingStore()
  store.createdAt = () => clock.now()
  const directory = new FakeAgentDirectory()
  directory.add(A, PID)
  const settings = new FakeBookingSettings()
  settings.restaurants.set(A, { name: 'Cafe A', logoUrl: null, whatsappNumber: '+85230001111' })
  holder.create = {
    directory, store, settings, limiter: new FakeRateLimiter(clock), secrets: scriptedSecrets(['K7PX3M']),
    privacyUrl: 'https://example.test/privacy', now: () => clock.now(),
  }
  holder.status = { directory, store, now: () => clock.now() }
  holder.openapi = { directory, settings, appUrl: 'https://app.example.test', privacyUrl: 'https://example.test/privacy' }
})

async function createBooking(): Promise<{ booking_id: string; status_token: string }> {
  const body = { date: '2026-11-20', time: '19:30', party_size: 2, name: 'Test Diner', phone: '+85290000001' }
  const req = new NextRequest(`https://app.example.test/api/poppy/${PID}/bookings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-real-ip': '203.0.113.9' },
    body: JSON.stringify(body),
  })
  return (await POST(req, { params: Promise.resolve({ publicId: PID }) })).json()
}

describe('BOOK-007 R7: poppy never shows no_show', () => {
  it('the status read of a no_show booking answers confirmed', async () => {
    const created = await createBooking()
    Object.assign(store.rows[0], { status: 'no_show', decidedAt: '2026-11-19T03:00:00.000Z' })
    const req = new NextRequest(`https://app.example.test/api/poppy/${PID}/bookings/${created.booking_id}`, {
      headers: { 'X-Booking-Status-Token': created.status_token },
    })
    const res = await GET_STATUS(req, { params: Promise.resolve({ publicId: PID, id: created.booking_id }) })
    expect(res.status).toBe(200)
    expect((await res.json()).status).toBe('confirmed')
  })

  it('the agent status mapping turns no_show into confirmed and passes the others through', () => {
    const now = new Date('2026-11-19T02:00:00.000Z')
    expect(agentBookingStatus('no_show', null, now)).toBe('confirmed')
    for (const s of ['pending', 'confirmed', 'declined', 'cancelled'] as const) expect(agentBookingStatus(s, null, now)).toBe(s)
  })

  it('the published status enum is unchanged (no no_show)', async () => {
    const res = await GET_OPENAPI(new Request('https://x'), { params: Promise.resolve({ publicId: PID }) })
    const doc = await res.json()
    expect(doc.components.schemas.BookingStatus.properties.status.enum).toEqual(PUBLISHED_STATUSES)
    expect(doc.components.schemas.CreatedBooking.properties.status.enum).toEqual(PUBLISHED_STATUSES)
    expect(JSON.stringify(doc)).not.toContain('no_show')
  })
})
