// AGENT-003: the reply agent takes a booking (threat R12–R17) and the tools follow the booking mode (AC-MODE).
import { describe, it, expect } from 'vitest'
import { AGENT_TOOL_DECLARATIONS, createAgentToolExecutor, declarationsFor } from '@/application/agent/agent-tools'
import { processAgentReply } from '@/application/agent/process-agent-reply'
import { admitInboundForAgent, type AgentReplyJob } from '@/application/agent/admit-inbound-for-agent'
import { AGENT_TOOL_NAMES, type AgentToolName } from '@/domain/value-objects/agent-config'
import type { BookingConfig, BookingMode } from '@/domain/value-objects/booking-config'
import type { AgentModelRequest } from '@/domain/ports/agent-model'
import { MAX_PENDING_PER_PHONE } from '@/domain/entities/booking-request'
import { buildSystemInstruction } from '@/application/agent/agent-prompt'
import {
  FakeAgentModel,
  FakeAgentStore,
  FakeClock,
  fakeBookingWorld,
  fakeToolData,
  okModel,
  workerHarness,
  type WorkerHarness,
} from './agent-fakes'

const R = 'rest-a'
const PHONE = '+85291234567'
const KEY = { restaurantId: R, phone: PHONE }
// FakeClock starts 2026-11-19T10:00Z = 18:00 in Hong Kong.
const TOMORROW = '2026-11-20'
const GOOD = { date: TOMORROW, time: '19:00', partySize: 4, name: '陳生' }

function setup(mode: BookingMode = 'simple', patch: Partial<BookingConfig> = {}) {
  const clock = new FakeClock()
  const store = new FakeAgentStore(clock)
  const world = fakeBookingWorld(clock)
  world.settings.setConfig(R, { mode, maxPartySize: 8, externalUrl: 'https://book.example.com/omc', ...patch })
  world.settings.restaurants.set(R, { name: 'OMC', logoUrl: null, whatsappNumber: null })

  /** A diner message arrives one minute later and its job's tool executor is built, as the worker does. */
  async function job(enabledTools: AgentToolName[] = [...AGENT_TOOL_NAMES]) {
    clock.advance(60_000)
    const row = store.seed({ restaurant_id: R, phone: PHONE, role: 'user', text: 'msg' })
    const { getConfig, ...ports } = world.deps
    const config = await getConfig(R)
    return createAgentToolExecutor({
      key: KEY,
      enabledTools,
      handoffSilenceHours: 12,
      now: clock.now,
      data: fakeToolData(),
      silences: store,
      booking: { ...ports, config, inboundCreatedAt: () => store.userMessageCreatedAt(KEY, row.id) },
    })
  }
  return { clock, store, world, job }
}

describe('AC-R12 booking tools take no identity: the job key decides', () => {
  it('AC-R12 injected phone / restaurant / member / booking ids are ignored; proposal and row carry the job key', async () => {
    const { world, job } = setup()
    const first = await job()
    const out = await first('propose_booking', {
      ...GOOD,
      phone: '+85298887777',
      restaurant_id: 'rest-b',
      restaurantId: 'rest-b',
      member_id: 'm-other',
      booking_id: 'b-1',
    })
    expect(out).toMatchObject({ proposed: true, booking: { ...GOOD, notes: null } })
    expect([...world.proposals.entries.keys()]).toEqual([`${R}|${PHONE}`])

    const second = await job()
    expect(await second('create_booking_request', { phone: '+85298887777', restaurantId: 'rest-b', booking_id: 'b-1' })).toMatchObject({ booked: true })
    expect(world.requests.rows).toHaveLength(1)
    expect(world.requests.rows[0]).toMatchObject({ restaurantId: R, phone: PHONE })
  })

  it('AC-R12 no declaration has an identity parameter; propose_booking takes only the booking fields', () => {
    expect(Object.keys(AGENT_TOOL_DECLARATIONS.propose_booking.parameters?.properties ?? {}).sort()).toEqual(
      ['date', 'name', 'notes', 'partySize', 'time']
    )
    for (const d of Object.values(AGENT_TOOL_DECLARATIONS)) {
      for (const param of Object.keys(d.parameters?.properties ?? {})) {
        expect(param).not.toMatch(/phone|restaurant|member|booking|id$/i)
      }
    }
    expect(AGENT_TOOL_DECLARATIONS.create_booking_request.parameters).toBeUndefined()
    expect(AGENT_TOOL_DECLARATIONS.get_booking_link.parameters).toBeUndefined()
  })
})

describe('AC-R13 propose_booking validates with BOOK-001 rules', () => {
  it.each([
    ['party 0', { partySize: 0 }, { partySize: 'too_small' }],
    ['party above maxPartySize', { partySize: 9 }, { partySize: 'too_large' }],
    ['past date', { date: '2026-11-18' }, { date: 'past' }],
    ['25:00', { time: '25:00' }, { time: 'invalid' }],
    ['61-char name', { name: 'x'.repeat(61) }, { name: 'too_long' }],
    ['today at a time already past', { date: '2026-11-19', time: '17:00' }, { time: 'past_time' }],
  ])('AC-R13 %s → field errors, nothing stored', async (_label, patch, fields) => {
    const { world, job } = setup()
    const propose = await job()
    expect(await propose('propose_booking', { ...GOOD, ...patch })).toMatchObject({ error: 'invalid', fields })
    expect(world.proposals.entries.size).toBe(0)
    const next = await job()
    expect(await next('create_booking_request', {})).toMatchObject({ error: 'no_proposal' })
    expect(world.requests.rows).toHaveLength(0)
  })
})

describe('AC-R14 per-phone open request cap', () => {
  async function seedPending(world: ReturnType<typeof setup>['world'], n: number) {
    for (let i = 0; i < n; i++) {
      await world.requests.insert({
        restaurantId: R, memberId: null, phone: PHONE, name: 'Old', partySize: 2, bookingDate: TOMORROW,
        bookingTime: '12:00', notes: null, source: 'chat', campaignId: null, token: `tok-${i}`,
      })
    }
  }

  it('AC-R14 at the cap (pending + live BOOK-003 unverified) → too_many_pending at propose, nothing stored', async () => {
    const { world, job } = setup()
    await seedPending(world, MAX_PENDING_PER_PHONE - 1)
    world.unverified.value = 1
    const propose = await job()
    expect(await propose('propose_booking', GOOD)).toMatchObject({ error: 'too_many_pending' })
    expect(world.proposals.entries.size).toBe(0)
  })

  it('AC-R14 cap reached between propose and create → too_many_pending, no insert', async () => {
    const { world, job } = setup()
    expect(await (await job())('propose_booking', GOOD)).toMatchObject({ proposed: true })
    await seedPending(world, MAX_PENDING_PER_PHONE)
    expect(await (await job())('create_booking_request', {})).toMatchObject({ error: 'too_many_pending' })
    expect(world.requests.rows.filter((r) => r.source === 'agent')).toHaveLength(0)
  })
})

describe('AC-R15 two-step gate', () => {
  it('AC-R15 no proposal → refused', async () => {
    const { world, job } = setup()
    expect(await (await job())('create_booking_request', {})).toMatchObject({ error: 'no_proposal' })
    expect(world.requests.rows).toHaveLength(0)
  })

  it('AC-R15 propose and create in the same job → refused; the proposal survives for the next message', async () => {
    const { world, job } = setup()
    const same = await job()
    await same('propose_booking', GOOD)
    expect(await same('create_booking_request', {})).toMatchObject({ error: 'awaiting_diner_confirmation' })
    expect(world.requests.rows).toHaveLength(0)
    expect(await (await job())('create_booking_request', {})).toMatchObject({ booked: true })
  })

  it('AC-R15 a job older than the proposing one cannot use it', async () => {
    const { world, store, clock, job } = setup()
    clock.advance(60_000)
    const older = store.seed({ restaurant_id: R, phone: PHONE, role: 'user', text: 'older' })
    await (await job())('propose_booking', GOOD)
    const { getConfig, ...ports } = world.deps
    const olderExec = createAgentToolExecutor({
      key: KEY, enabledTools: [...AGENT_TOOL_NAMES], handoffSilenceHours: 12, now: clock.now, data: fakeToolData(), silences: store,
      booking: { ...ports, config: await getConfig(R), inboundCreatedAt: () => store.userMessageCreatedAt(KEY, older.id) },
    })
    expect(await olderExec('create_booking_request', {})).toMatchObject({ error: 'awaiting_diner_confirmation' })
    expect(world.requests.rows).toHaveLength(0)
  })

  it('AC-R15 expired (30 min) → refused', async () => {
    const { world, clock, job } = setup()
    await (await job())('propose_booking', GOOD)
    clock.advance(30 * 60_000)
    expect(await (await job())('create_booking_request', {})).toMatchObject({ error: 'no_proposal' })
    expect(world.requests.rows).toHaveLength(0)
  })

  it('AC-R15 second create → refused (single use)', async () => {
    const { world, job } = setup()
    await (await job())('propose_booking', GOOD)
    const next = await job()
    expect(await next('create_booking_request', {})).toMatchObject({ booked: true })
    expect(await next('create_booking_request', {})).toMatchObject({ error: 'no_proposal' })
    expect(await (await job())('create_booking_request', {})).toMatchObject({ error: 'no_proposal' })
    expect(world.requests.rows).toHaveLength(1)
  })

  it('AC-R15 happy path → exactly one pending row with the proposal’s fields', async () => {
    const { world, job } = setup()
    world.memberIds.set(`${R}|${PHONE}`, 'member-1')
    await (await job())('propose_booking', { ...GOOD, notes: '  BB 凳  ' })
    expect(await (await job())('create_booking_request', {})).toEqual({
      booked: true,
      status: 'pending',
      note: expect.any(String),
    })
    expect(world.requests.rows).toHaveLength(1)
    expect(world.requests.rows[0]).toMatchObject({
      restaurantId: R, phone: PHONE, memberId: 'member-1', name: '陳生', partySize: 4, bookingDate: TOMORROW,
      bookingTime: '19:00', notes: 'BB 凳', status: 'pending', campaignId: null, token: null,
    })
  })

  it('AC-R15 a newer proposal replaces the older one; create books the newest', async () => {
    const { world, job } = setup()
    await (await job())('propose_booking', GOOD)
    await (await job())('propose_booking', { ...GOOD, partySize: 6 })
    await (await job())('create_booking_request', {})
    expect(world.requests.rows.map((r) => r.partySize)).toEqual([6])
  })
})

describe('AC-R16 pending only, "received" message best effort', () => {
  it('AC-R16 the row is pending and the received message goes out once', async () => {
    const { world, job } = setup()
    await (await job())('propose_booking', GOOD)
    await (await job())('create_booking_request', {})
    expect(world.requests.rows[0].status).toBe('pending')
    expect(world.sender.sent).toHaveLength(1)
    expect(world.sender.sent[0]).toMatchObject({
      restaurantId: R, phone: PHONE, kind: 'received',
      details: { restaurantName: 'OMC', name: '陳生', date: TOMORROW, time: '19:00', partySize: 4 },
    })
  })

  it('AC-R16 a failed or throwing send does not fail the booking', async () => {
    for (const fail of ['undelivered', 'throws'] as const) {
      const { world, job } = setup()
      if (fail === 'undelivered') world.sender.result = { delivered: false, reason: 'send_failed' }
      else world.sender.send = async () => { throw new Error('kapso down') }
      await (await job())('propose_booking', GOOD)
      expect(await (await job())('create_booking_request', {})).toMatchObject({ booked: true, status: 'pending' })
      expect(world.requests.rows).toHaveLength(1)
    }
  })
})

describe('AC-R17 provenance', () => {
  it('AC-R17 the agent’s booking is marked source agent ("via AI agent" in 訂座)', async () => {
    const { world, job } = setup()
    await (await job())('propose_booking', GOOD)
    await (await job())('create_booking_request', {})
    expect(world.requests.rows[0].source).toBe('agent')
  })
})

describe('AC-MODE booking tools follow the booking mode', () => {
  const names = (mode: BookingMode | null, enabled: AgentToolName[] = [...AGENT_TOOL_NAMES]) =>
    declarationsFor(enabled, mode).map((d) => d.name)

  it('AC-MODE off (or unreadable) → no booking tool declared', () => {
    expect(names('off')).toEqual(['get_member_summary', 'list_rewards', 'handoff_to_staff'])
    expect(names(null)).toEqual(['get_member_summary', 'list_rewards', 'handoff_to_staff'])
  })

  it('AC-MODE simple → propose + create; external → get_booking_link only', () => {
    expect(names('simple')).toEqual(['get_member_summary', 'list_rewards', 'handoff_to_staff', 'propose_booking', 'create_booking_request'])
    expect(names('external')).toEqual(['get_member_summary', 'list_rewards', 'handoff_to_staff', 'get_booking_link'])
  })

  it('AC-MODE always also gated by enabledTools', () => {
    expect(names('simple', ['list_rewards', 'create_booking_request'])).toEqual(['list_rewards', 'create_booking_request'])
    expect(names('external', ['propose_booking'])).toEqual([])
  })

  it('AC-MODE calling a tool the mode does not offer runs nothing', async () => {
    for (const mode of ['off', 'external'] as const) {
      const { world, job } = setup(mode)
      expect(await (await job())('propose_booking', GOOD)).toEqual({ error: 'tool_not_available' })
      expect(world.proposals.entries.size).toBe(0)
    }
    const { job } = setup('simple')
    expect(await (await job())('get_booking_link', {})).toEqual({ error: 'tool_not_available' })
  })

  it('AC-MODE external → get_booking_link returns the external URL', async () => {
    const { job } = setup('external')
    expect(await (await job())('get_booking_link', {})).toMatchObject({ url: 'https://book.example.com/omc' })
  })
})

// ---------------------------------------------------------------------------
// The worker end to end: two diner messages, model scripted to call the tools.

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

const callsTool = (name: string, args: Record<string, unknown>, text: string) => async (req: AgentModelRequest) => {
  await req.executeTool(name, args)
  return okModel(text, [name])
}

describe('AC-MODE / AC-R17 the worker passes booking tools per mode and records the tool calls', () => {
  it.each(['auto', 'shadow'] as const)('AC-R17 %s: propose → read-back, then "好" → one pending agent row; agent rows name the tools', async (mode) => {
    const model = new FakeAgentModel([
      callsTool('propose_booking', GOOD, '幫你確認：聽日 19:00，4 位，陳生，啱唔啱？'),
      callsTool('create_booking_request', {}, '已收到你嘅訂座要求，餐廳會再確認。'),
    ])
    const h = workerHarness({ config: { mode }, model })
    h.booking.settings.setConfig(R, { mode: 'simple', maxPartySize: 8 })
    await processAgentReply(h.deps, await inbound(h, '我想訂枱，聽日7點4位，陳生', 'wamid.1'))
    h.clock.advance(60_000)
    await processAgentReply(h.deps, await inbound(h, '好', 'wamid.2'))

    expect(h.booking.requests.rows).toHaveLength(1)
    expect(h.booking.requests.rows[0]).toMatchObject({ status: 'pending', source: 'agent', partySize: 4, bookingTime: '19:00' })
    expect(h.store.modelRows().map((r) => r.tool_calls)).toEqual([['propose_booking'], ['create_booking_request']])
    expect(model.requests[0].tools.map((t) => t.name)).toContain('propose_booking')
    expect(model.requests[0].systemInstruction).toContain('CURRENT DATE AND TIME IN HONG KONG: 2026-11-19 (Thursday) 18:00')
  })

  it('AC-MODE booking mode off → the model is offered no booking tool and no clock line', async () => {
    const model = new FakeAgentModel([okModel('Hi')])
    const h = workerHarness({ model })
    await processAgentReply(h.deps, await inbound(h, 'hi', 'wamid.1'))
    expect(model.requests[0].tools.map((t) => t.name)).toEqual(['get_member_summary', 'list_rewards', 'handoff_to_staff'])
    expect(model.requests[0].systemInstruction).toBe(buildSystemInstruction(h.currentConfig()))
  })

  it('AC-MODE an unreadable booking config → no booking tool, the reply still goes out', async () => {
    const model = new FakeAgentModel([okModel('Hi')])
    const h = workerHarness({ model })
    h.deps.booking.getConfig = async () => {
      throw new Error('db down')
    }
    expect(await processAgentReply(h.deps, await inbound(h, 'hi', 'wamid.1'))).toBe('sent')
    expect(model.requests[0].tools.map((t) => t.name)).not.toContain('propose_booking')
  })
})

describe('AC-R18 the worker resolves the fallback model and records what answered', () => {
  it('AC-R18 fallback model: tenant → env AGENT_FALLBACK_MODEL → gemini-3.5-flash-lite', async () => {
    const cases: Array<[Record<string, unknown>, string | undefined, string]> = [
      [{}, undefined, 'gemini-3.5-flash-lite'],
      [{}, 'gemini-env-lite', 'gemini-env-lite'],
      [{ fallbackModel: 'gemini-tenant-lite' }, 'gemini-env-lite', 'gemini-tenant-lite'],
      [{ fallbackModel: 'Bad Model/../x' }, undefined, 'gemini-3.5-flash-lite'],
    ]
    for (const [config, env, expected] of cases) {
      const model = new FakeAgentModel([okModel('Hi')])
      const h = workerHarness({ config, model })
      h.deps.envFallbackModel = env
      await processAgentReply(h.deps, await inbound(h, 'hi', 'wamid.1'))
      expect(model.requests[0].fallbackModel).toBe(expected)
    }
  })

  it('AC-R18 the row records the model that answered; the log has httpStatus and no text', async () => {
    const model = new FakeAgentModel([{ ...okModel('Hi there'), model: 'gemini-3.5-flash-lite', httpStatus: 200 }])
    const h = workerHarness({ model })
    await processAgentReply(h.deps, await inbound(h, '你好', 'wamid.1'))
    expect(h.store.modelRows()[0].model).toBe('gemini-3.5-flash-lite')
    const line = h.logs.find((l) => l.event === 'agent.reply')
    expect(line?.data).toMatchObject({ outcome: 'sent', httpStatus: 200 })
    const serialized = JSON.stringify(h.logs)
    for (const secret of ['Hi there', '你好', PHONE]) expect(serialized).not.toContain(secret)
  })

  it('AC-R18 a failed run logs the last HTTP status as a number', async () => {
    const model = new FakeAgentModel([
      { ok: false, reason: 'http', toolCalls: [], usage: { promptTokens: 0, outputTokens: 0 }, model: 'gemini-3.5-flash-lite', httpStatus: 503 },
    ])
    const h = workerHarness({ model })
    expect(await processAgentReply(h.deps, await inbound(h, 'hi', 'wamid.1'))).toBe('fallback')
    expect(h.logs.find((l) => l.event === 'agent.reply')?.data).toMatchObject({ reason: 'http', httpStatus: 503 })
  })
})
