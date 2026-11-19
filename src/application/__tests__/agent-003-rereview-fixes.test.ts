// AGENT-003 re-review fix round (reviews/2026-11-19-agent-003-rereview): N1 at the worker, N2 at the diner cancel.
import { describe, it, expect } from 'vitest'
import { processAgentReply } from '@/application/agent/process-agent-reply'
import { admitInboundForAgent, type AgentReplyJob } from '@/application/agent/admit-inbound-for-agent'
import { dinerCancelFilter } from '@/infrastructure/supabase/repositories/booking-request-repository'
import type { BookingRequest } from '@/domain/entities/booking-request'
import { workerHarness, type WorkerHarness } from './agent-fakes'

const R = 'rest-a'
const PHONE = '+85291234567'

async function inbound(h: WorkerHarness, text: string, wamid: string): Promise<AgentReplyJob> {
  const jobs: AgentReplyJob[] = []
  await admitInboundForAgent(
    {
      getConfig: async () => h.currentConfig(),
      messages: h.store,
      silences: h.store,
      enqueue: async (job) => void jobs.push(job),
      now: h.clock.now,
      log: h.deps.log,
    },
    { restaurantId: R, phone: PHONE, wamid, text }
  )
  return jobs[0]
}

describe('AC-N1 a job error still answers the diner when the handoff row cannot be written', () => {
  it('AC-N1 the row insert throws (deliver, then the handoff claim) → exactly one menu, no handoff', async () => {
    const h = workerHarness({ config: { mode: 'auto', failureAction: 'handoff' } })
    const job = await inbound(h, 'hi', 'w1')
    h.store.recordModelRow = async () => {
      throw new Error('insert failed')
    }
    expect(await processAgentReply(h.deps, job)).toBe('error')
    expect(h.fallbacks).toHaveLength(1)
    expect(h.sends).toEqual([])
  })

  it('AC-N1 model error, then the handoff claim throws → exactly one menu, no handoff', async () => {
    const h = workerHarness({ config: { mode: 'auto', failureAction: 'handoff' } })
    const job = await inbound(h, 'hi', 'w1')
    h.deps.model = { respond: async () => { throw new Error('bug') } }
    h.store.recordModelRow = async () => {
      throw new Error('insert failed')
    }
    expect(await processAgentReply(h.deps, job)).toBe('error')
    expect(h.fallbacks).toHaveLength(1)
    expect(h.sends).toEqual([])
  })

  it('AC-N1 the handoff claim is taken (another run answered) → no send at all (unchanged)', async () => {
    const h = workerHarness({ config: { mode: 'auto', failureAction: 'handoff' } })
    const job = await inbound(h, 'hi', 'w1')
    h.deps.model = { respond: async () => { throw new Error('bug') } }
    h.store.recordModelRow = async () => ({ kind: 'taken' })
    expect(await processAgentReply(h.deps, job)).toBe('error')
    expect(h.fallbacks).toEqual([])
    expect(h.sends).toEqual([])
  })
})

describe('AC-N2 the diner cancel applies "upcoming" to the target only', () => {
  // FakeClock starts 2026-11-19T10:00Z = 18:00 HK; +3 h = 21:00 HK.
  const AT_2100 = { date: '2026-11-19', time: '21:00' }

  async function seed(h: WorkerHarness, patch: Partial<BookingRequest>) {
    const row = await h.booking.requests.insert({
      restaurantId: R, memberId: 'member-1', phone: PHONE, name: '陳生', partySize: 4, bookingDate: '2026-11-25',
      bookingTime: '19:30', notes: null, source: 'chat', campaignId: null, token: `tok-${Math.random()}`,
    } as never)
    Object.assign(row, patch)
    return row
  }

  it('AC-N2 target tomorrow + its pending change request for today 12:00, at 21:00 HK → both cancelled', async () => {
    const h = workerHarness({ config: { mode: 'auto' } })
    h.clock.advance(3 * 3_600_000)
    const target = await seed(h, { bookingDate: '2026-11-20', bookingTime: '19:00', status: 'confirmed', decidedAt: '2026-11-19T01:00:00.000Z' })
    const change = await seed(h, { bookingDate: '2026-11-19', bookingTime: '12:00', replacesBookingId: target.id })
    const ids = await h.booking.requests.cancelByDiner({ restaurantId: R, phone: PHONE, id: target.id, from: AT_2100, at: h.clock.now() })
    expect(ids.sort()).toEqual([target.id, change.id].sort())
    expect(target.status).toBe('cancelled')
    expect(change.status).toBe('cancelled')
  })

  it('AC-N2 the target itself today 12:00 at 21:00 HK → refused (F10 kept)', async () => {
    const h = workerHarness({ config: { mode: 'auto' } })
    h.clock.advance(3 * 3_600_000)
    const past = await seed(h, { bookingDate: '2026-11-19', bookingTime: '12:00', status: 'confirmed', decidedAt: '2026-11-19T01:00:00.000Z' })
    expect(await h.booking.requests.cancelByDiner({ restaurantId: R, phone: PHONE, id: past.id, from: AT_2100, at: h.clock.now() })).toEqual([])
    expect(past.status).toBe('confirmed')
  })

  it('AC-N2 the repository UPDATE filter nests "upcoming" under the target id only', () => {
    const X = 'b0000000-0000-4000-8000-000000000001'
    expect(dinerCancelFilter(X, AT_2100)).toBe(
      `and(id.eq.${X},or(booking_date.gt.2026-11-19,and(booking_date.eq.2026-11-19,booking_time.gte.21:00))),` +
        `and(replaces_booking_id.eq.${X},status.eq.pending)`
    )
  })
})
