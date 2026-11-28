// AGENT-003 review fix round (reviews/2026-11-19-agent-003-code-review): F1–F3, F5, F7–F10 at the worker and the tools.
import { describe, it, expect } from 'vitest'
import { processAgentReply } from '@/application/agent/process-agent-reply'
import { admitInboundForAgent, type AgentReplyJob } from '@/application/agent/admit-inbound-for-agent'
import { createAgentToolExecutor, declarationsFor } from '@/application/agent/agent-tools'
import { cancelledText } from '@/application/agent/agent-booking-change-tools'
import { pendingProposalLine } from '@/application/agent/agent-prompt'
import { decideBookingRequest } from '@/application/booking/decide-booking-request'
import { AGENT_TOOL_NAMES, DEFAULT_DISCLOSURE_TEXT, type AgentToolName } from '@/domain/value-objects/agent-config'
import { HANDOFF_APOLOGY, withDisclosure } from '@/domain/services/agent-reply-text'
import { summarizeAgentThreads } from '@/domain/services/agent-conversation-log'
import type { AgentModelRequest, AgentModelResult, AgentToolOutput } from '@/domain/ports/agent-model'
import type { BookingRequest } from '@/domain/entities/booking-request'
import {
  FakeAgentModel,
  FakeAgentStore,
  FakeClock,
  failedModel,
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
const GOOD = { date: '2026-11-20', time: '19:00', partySize: 4, name: '陳生' }
const ALL_TOOLS = { enabledTools: [...AGENT_TOOL_NAMES] }
const WAITING = 'WAITING FOR THE DINER'

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

/** A model turn that calls `name` and answers `text`; the tool's output lands in `outputs`. */
function callsTool(name: string, args: Record<string, unknown>, text: string, outputs: AgentToolOutput[] = []) {
  return async (req: AgentModelRequest): Promise<AgentModelResult> => {
    outputs.push(await req.executeTool(name, args))
    return okModel(text, [name])
  }
}

function harness(config: Record<string, unknown> = {}, model?: FakeAgentModel) {
  const h = workerHarness({ config: { mode: 'auto', ...ALL_TOOLS, ...config }, model })
  h.booking.settings.setConfig(R, { mode: 'simple', maxPartySize: 8 })
  h.booking.settings.restaurants.set(R, { name: 'OMC', logoUrl: null, whatsappNumber: null })
  return h
}

async function seedBooking(h: { booking: { requests: { insert: (r: never) => Promise<BookingRequest> } } }, patch: Partial<BookingRequest> = {}) {
  const row = await h.booking.requests.insert({
    restaurantId: R, memberId: 'member-1', phone: PHONE, name: '陳生', partySize: 4, bookingDate: '2026-11-25',
    bookingTime: '19:30', notes: null, source: 'chat', campaignId: null, token: `tok-${Math.random()}`,
  } as never)
  Object.assign(row, patch)
  return row
}

/** The "好" job: its model calls `confirmTool`; returns the tool output and the request the model saw. */
async function confirmNext(h: WorkerHarness, confirmTool = 'create_booking_request') {
  const outputs: AgentToolOutput[] = []
  h.model.results = [callsTool(confirmTool, {}, 'OK', outputs)]
  const seen = h.model.requests.length
  h.clock.advance(60_000)
  await processAgentReply(h.deps, await inbound(h, '好', `wamid.yes.${Math.random()}`))
  return { output: outputs[0], request: h.model.requests[seen] }
}

describe('AC-F1 a proposal is confirmable only after its read-back reached the diner', () => {
  it('AC-F1 sent read-back → the next message confirms it (and gets the WAITING line)', async () => {
    const h = harness({}, new FakeAgentModel([callsTool('propose_booking', GOOD, '19:00 4 位，啱唔啱？')]))
    expect(await processAgentReply(h.deps, await inbound(h, '訂枱', 'w1'))).toBe('sent')
    const { output, request } = await confirmNext(h)
    expect(output).toMatchObject({ booked: true })
    expect(request.systemInstruction).toContain(pendingProposalLine('create'))
    expect(h.booking.requests.rows).toHaveLength(1)
  })

  it('AC-F1 superseded proposing job → proposal deleted; a newer job never sees it (even while the old job still runs)', async () => {
    const h = harness()
    const during: AgentToolOutput[] = []
    let duringRequest: AgentModelRequest | null = null
    h.model.results = [
      async (req) => {
        await req.executeTool('propose_booking', GOOD)
        // A newer diner message arrives and its job runs while this one is still in its model call.
        h.clock.advance(10_000)
        const newer = await inbound(h, '好', 'w2')
        h.model.results = [async (r2) => ((duringRequest = r2), during.push(await r2.executeTool('create_booking_request', {})), okModel('?', ['create_booking_request']))]
        await processAgentReply(h.deps, newer)
        return okModel('19:00 4 位，啱唔啱？', ['propose_booking'])
      },
    ]
    expect(await processAgentReply(h.deps, await inbound(h, '訂枱', 'w1'))).toBe('skipped')
    expect(during[0]).toMatchObject({ error: 'no_proposal' })
    expect((duringRequest as AgentModelRequest | null)?.systemInstruction).not.toContain(WAITING)
    expect(h.booking.proposals.entries.size).toBe(0)
    const { output, request } = await confirmNext(h)
    expect(output).toMatchObject({ error: 'no_proposal' })
    expect(request.systemInstruction).not.toContain(WAITING)
    expect(h.booking.requests.rows).toHaveLength(0)
  })

  const closeWindow = (w: WorkerHarness): void => {
    w.windowOpen.value = false
  }
  const failSend = (w: WorkerHarness): void => {
    w.sendResult.value = { ok: false, error: 'x', raw: null } as never
  }
  const nothing = (): void => undefined
  it.each([
    ['failure → handoff', { failureAction: 'handoff' }, nothing, 'handoff'],
    ['failure → menu', { failureAction: 'menu' }, nothing, 'fallback'],
    ['window closed (skipped)', {}, closeWindow, 'skipped'],
    ['send failed → menu', {}, failSend, 'fallback'],
  ] as const)('AC-F1 %s → proposal deleted; the next "好" gets no_proposal and no WAITING line', async (_label, config, arrange, outcome) => {
    const failing = _label.startsWith('failure')
    const h = harness(config)
    h.model.results = [
      async (req) => {
        await req.executeTool('propose_booking', GOOD)
        return failing ? { ...failedModel('truncated'), toolCalls: ['propose_booking'] } : okModel('19:00 4 位，啱唔啱？', ['propose_booking'])
      },
    ]
    arrange(h)
    expect(await processAgentReply(h.deps, await inbound(h, '訂枱', 'w1'))).toBe(outcome)
    expect(h.booking.proposals.entries.size).toBe(0)
    h.windowOpen.value = true
    h.sendResult.value = { ok: true, kapsoMessageId: 'wamid.out', raw: null } as never
    const { output, request } = await confirmNext(h)
    expect(output).toMatchObject({ error: 'no_proposal' })
    expect(request.systemInstruction).not.toContain(WAITING)
    expect(h.booking.requests.rows).toHaveLength(0)
  })

  it('AC-F1 claim lost (another run of this job already answered) → this run’s proposal deleted', async () => {
    const h = harness()
    h.model.results = [callsTool('propose_booking', GOOD, '19:00 4 位，啱唔啱？')]
    const job = await inbound(h, '訂枱', 'w1')
    await h.store.recordModelRow({ ...KEY, outcome: 'sent', text: 'other run', model: 'm', latencyMs: 1, toolCalls: [], replyToMessageId: job.messageRowId })
    expect(await processAgentReply(h.deps, job)).toBe('duplicate')
    expect(h.booking.proposals.entries.size).toBe(0)
    expect((await confirmNext(h)).output).toMatchObject({ error: 'no_proposal' })
  })

  it('AC-F1 job error after the proposal → deleted', async () => {
    const h = harness()
    h.model.results = [
      async (req) => {
        await req.executeTool('propose_booking', GOOD)
        throw new Error('bug')
      },
    ]
    expect(await processAgentReply(h.deps, await inbound(h, '訂枱', 'w1'))).toBe('error')
    expect(h.booking.proposals.entries.size).toBe(0)
    expect((await confirmNext(h)).output).toMatchObject({ error: 'no_proposal' })
  })

  it('AC-F1 a run whose proposal was replaced by a newer run cannot confirm or delete the newer one', async () => {
    const h = harness()
    await h.booking.proposals.save(KEY, { kind: 'create', booking: { ...GOOD, notes: null }, inboundCreatedAt: '2026-11-19T10:00:00.000Z', proposedAt: '2026-11-19T10:00:00.000Z' }, 60_000, 'newer-run')
    expect(await h.booking.proposals.markConfirmable(KEY, 'older-run')).toBe(false)
    await h.booking.proposals.discard(KEY, 'older-run')
    expect(h.booking.proposals.entries.get(`${R}|${PHONE}`)).toMatchObject({ owner: 'newer-run', confirmable: false })
  })

  it('AC-F1 shadow (OR5): a create proposal is confirmable once the draft row is stored', async () => {
    const h = harness({ mode: 'shadow' }, new FakeAgentModel([callsTool('propose_booking', GOOD, '19:00 4 位，啱唔啱？')]))
    expect(await processAgentReply(h.deps, await inbound(h, '訂枱', 'w1'))).toBe('shadow_draft')
    expect(h.booking.proposals.entries.get(`${R}|${PHONE}`)).toMatchObject({ confirmable: true, proposal: { kind: 'create' } })
    expect((await confirmNext(h)).output).toMatchObject({ booked: true })
  })
})

describe('AC-F2 shadow is offered no change/cancel tool', () => {
  const CHANGE_CANCEL = ['propose_booking_change', 'confirm_booking_change', 'propose_booking_cancel', 'confirm_booking_cancel']

  it('AC-F2 shadow declarations exclude the 4 change/cancel tools; auto includes them when enabled', () => {
    const shadow = declarationsFor([...AGENT_TOOL_NAMES], 'simple', 'shadow').map((d) => d.name)
    const auto = declarationsFor([...AGENT_TOOL_NAMES], 'simple', 'auto').map((d) => d.name)
    for (const t of CHANGE_CANCEL) {
      expect(shadow).not.toContain(t)
      expect(auto).toContain(t)
    }
    expect(shadow).toEqual(expect.arrayContaining(['list_my_bookings', 'propose_booking', 'create_booking_request']))
  })

  it('AC-F2 a shadow worker run declares none of them, and a call to one runs nothing (no cancel, no text)', async () => {
    const h = harness({ mode: 'shadow' })
    const target = await seedBooking(h, { status: 'confirmed', decidedAt: '2026-11-19T09:00:00.000Z' })
    const outputs: AgentToolOutput[] = []
    h.model.results = [callsTool('propose_booking_cancel', { bookingRef: target.id.slice(0, 8) }, 'x', outputs)]
    await processAgentReply(h.deps, await inbound(h, '取消', 'w1'))
    const names = h.model.requests[0].tools.map((t) => t.name)
    for (const t of CHANGE_CANCEL) expect(names).not.toContain(t)
    expect(outputs[0]).toEqual({ error: 'tool_not_available' })
    expect(h.booking.proposals.entries.size).toBe(0)
    expect(target.status).toBe('confirmed')
    expect(h.booking.texts).toEqual([])
  })
})

describe('AC-F3 a confirmed change is an ordinary booking', () => {
  function tools() {
    const clock = new FakeClock()
    const store = new FakeAgentStore(clock)
    const world = fakeBookingWorld(clock)
    world.settings.setConfig(R, { mode: 'simple', maxPartySize: 8 })
    world.settings.restaurants.set(R, { name: 'OMC', logoUrl: null, whatsappNumber: null })
    async function job() {
      world.proposals.deliverAll()
      clock.advance(60_000)
      const row = store.seed({ restaurant_id: R, phone: PHONE, role: 'user', text: 'msg' })
      const { getConfig, ...ports } = world.deps
      return createAgentToolExecutor({
        key: KEY, enabledTools: [...AGENT_TOOL_NAMES], agentMode: 'auto', handoffSilenceHours: 12, now: clock.now,
        data: fakeToolData(), silences: store,
        booking: {
          ...ports, config: await getConfig(R), inboundCreatedAt: () => store.userMessageCreatedAt(KEY, row.id),
          proposalOwner: `run-${row.id}`, disclosureText: DEFAULT_DISCLOSURE_TEXT,
        },
      })
    }
    return { world, job, booking: world }
  }

  it('AC-F3 a confirmed row with replaces_booking_id is listed as a normal booking and can be changed again', async () => {
    const { world, job, booking } = tools()
    const old = await seedBooking({ booking }, { status: 'cancelled', cancelledBy: 'change' })
    const changed = await seedBooking({ booking }, { status: 'confirmed', bookingDate: '2026-11-26', bookingTime: '20:00', replacesBookingId: old.id, decidedAt: '2026-11-19T09:00:00.000Z' })
    const listed = (await (await job())('list_my_bookings', {})) as { bookings: Array<Record<string, unknown>> }
    expect(listed.bookings).toEqual([{ ref: changed.id.slice(0, 8), date: '2026-11-26', time: '20:00', partySize: 4, status: 'confirmed' }])
    expect(await (await job())('propose_booking_change', { bookingRef: changed.id.slice(0, 8), time: '21:00' })).toMatchObject({ proposed: true })
    expect(await (await job())('confirm_booking_change', {})).toMatchObject({ changeRequested: true })
    expect(world.requests.rows.filter((r) => r.replacesBookingId === changed.id && r.status === 'pending')).toHaveLength(1)
  })

  it('AC-F3 a PENDING change request is still not changeable and still labelled', async () => {
    const { job, booking } = tools()
    const original = await seedBooking({ booking }, { status: 'confirmed', decidedAt: '2026-11-19T09:00:00.000Z' })
    const open = await seedBooking({ booking }, { bookingDate: '2026-11-26', replacesBookingId: original.id })
    const listed = (await (await job())('list_my_bookings', {})) as { bookings: Array<Record<string, unknown>> }
    expect(listed.bookings.find((b) => b.ref === open.id.slice(0, 8))).toMatchObject({ changeRequestFor: original.id.slice(0, 8) })
    expect(await (await job())('propose_booking_change', { bookingRef: open.id.slice(0, 8), time: '21:00' })).toMatchObject({ error: 'not_changeable' })
    expect(await (await job())('propose_booking_change', { bookingRef: original.id.slice(0, 8), time: '21:00' })).toMatchObject({ error: 'change_already_pending' })
  })
})

describe('AC-F5 every proposing tool gets the WAITING line', () => {
  it('AC-F5 cancel-only tool set gets the WAITING line after a sent cancel read-back', async () => {
    const cancelOnly: AgentToolName[] = ['list_my_bookings', 'propose_booking_cancel', 'confirm_booking_cancel']
    const h = harness({ enabledTools: cancelOnly })
    const target = await seedBooking(h, { status: 'confirmed', decidedAt: '2026-11-19T09:00:00.000Z' })
    h.model.results = [callsTool('propose_booking_cancel', { bookingRef: target.id.slice(0, 8) }, '取消 25 號 19:30，確定？')]
    expect(await processAgentReply(h.deps, await inbound(h, '取消', 'w1'))).toBe('sent')
    const { output, request } = await confirmNext(h, 'confirm_booking_cancel')
    expect(request.systemInstruction).toContain(pendingProposalLine('cancel'))
    expect(output).toMatchObject({ cancelled: true })
  })
})

describe('AC-F7 a job error hands off with a claimed row (thread needs staff); an unreadable config → the menu', () => {
  const threadOf = (h: WorkerHarness) =>
    summarizeAgentThreads([...h.store.rows].reverse().map((r) => ({ id: r.id, phone: r.phone, role: r.role, outcome: r.outcome, createdAt: r.created_at })))[0]

  it('AC-F7 job error → the handoff row is claimed before the send and the thread needs staff', async () => {
    const h = workerHarness({ config: { failureAction: 'handoff' } })
    h.deps.model = { respond: async () => { throw new Error('bug') } }
    const rowsAtSend: Array<string | null> = []
    const send = h.deps.sendText
    h.deps.sendText = async (...args) => (rowsAtSend.push(...h.store.modelRows().map((r) => r.outcome)), send(...args))
    expect(await processAgentReply(h.deps, await inbound(h, 'hi', 'w1'))).toBe('error')
    expect(rowsAtSend).toEqual(['handoff'])
    expect(h.sends).toHaveLength(1)
    expect(h.sends[0].text.startsWith(HANDOFF_APOLOGY)).toBe(true)
    expect(h.fallbacks).toEqual([])
    expect(h.store.modelRows().map((r) => [r.outcome, r.text?.startsWith(HANDOFF_APOLOGY)])).toEqual([['handoff', true]])
    expect(threadOf(h)).toMatchObject({ needsStaff: true })
  })

  it('AC-F7 job error with a handoff that does not go out → the menu; the claimed row says fallback', async () => {
    const h = workerHarness({ config: { failureAction: 'handoff' } })
    h.deps.model = { respond: async () => { throw new Error('bug') } }
    h.sendResult.value = { ok: false, error: 'x', raw: null } as never
    await processAgentReply(h.deps, await inbound(h, 'hi', 'w1'))
    expect(h.fallbacks).toHaveLength(1)
    expect(h.store.modelRows().map((r) => r.outcome)).toEqual(['fallback'])
  })

  it('AC-F7 config never read (the read throws) and still unreadable → the menu, not the handoff', async () => {
    const h = workerHarness({ config: { failureAction: 'handoff' } })
    const job = await inbound(h, 'hi', 'w1')
    let reads = 0
    h.deps.getConfig = async () => {
      reads++
      throw new Error('db down')
    }
    expect(await processAgentReply(h.deps, job)).toBe('error')
    expect(reads).toBe(2)
    expect(h.fallbacks).toHaveLength(1)
    expect(h.sends).toEqual([])
  })

  it('AC-F7 config never read, the second read works → the tenant’s failureAction (menu stays menu, handoff hands off)', async () => {
    for (const failureAction of ['menu', 'handoff'] as const) {
      const h = workerHarness({ config: { failureAction } })
      const job = await inbound(h, 'hi', 'w1')
      const read = h.deps.getConfig
      let reads = 0
      h.deps.getConfig = async (id) => {
        if (reads++ === 0) throw new Error('blip')
        return read(id)
      }
      await processAgentReply(h.deps, job)
      expect(h.fallbacks).toHaveLength(failureAction === 'menu' ? 1 : 0)
      expect(h.sends).toHaveLength(failureAction === 'handoff' ? 1 : 0)
      expect(threadOf(h).needsStaff).toBe(failureAction === 'handoff')
    }
  })
})

describe('AC-F8 declining a change request is not an undelivered message', () => {
  function deps() {
    const clock = new FakeClock()
    const world = fakeBookingWorld(clock)
    world.settings.restaurants.set(R, { name: 'OMC', logoUrl: null, whatsappNumber: null })
    const decide = (bookingId: string) =>
      decideBookingRequest(
        { requests: world.requests, settings: world.settings, sender: world.sender, now: clock.now },
        { restaurantId: R, userId: 'staff-1', bookingId, decision: 'declined' }
      )
    return { world, decide }
  }

  it('AC-F8 declined change request → delivered null, no message, no not_delivered status stored', async () => {
    const { world, decide } = deps()
    const original = await seedBooking({ booking: world }, { status: 'confirmed', decidedAt: '2026-11-19T09:00:00.000Z' })
    const change = await seedBooking({ booking: world }, { replacesBookingId: original.id })
    world.sender.result = { delivered: false, reason: 'outside_window' }
    const result = await decide(change.id)
    expect(result).toMatchObject({ ok: true, delivered: null, booking: { status: 'declined' } })
    expect(world.sender.sent).toEqual([])
    expect(world.requests.rows.find((r) => r.id === change.id)?.decisionMessageStatus).toBeNull()
  })

  it('AC-F8 BOOK-001 decline unchanged: the message is sent; a failed one is delivered false and stored not_delivered', async () => {
    const { world, decide } = deps()
    const plain = await seedBooking({ booking: world })
    world.sender.result = { delivered: false, reason: 'outside_window' }
    expect(await decide(plain.id)).toMatchObject({ ok: true, delivered: false })
    expect(world.sender.sent.map((m) => m.kind)).toEqual(['declined'])
    expect(world.requests.rows.find((r) => r.id === plain.id)?.decisionMessageStatus).toBe('not_delivered')
  })
})

describe('AC-F9 the cancel confirmation text carries the disclosure', () => {
  it('AC-F9 cancel text ends with the tenant disclosure', async () => {
    const disclosure = 'AI 助手 · Automated'
    const h = harness({ disclosureText: disclosure })
    const target = await seedBooking(h, { status: 'confirmed', decidedAt: '2026-11-19T09:00:00.000Z' })
    h.model.results = [callsTool('propose_booking_cancel', { bookingRef: target.id.slice(0, 8) }, '取消 25 號，確定？')]
    await processAgentReply(h.deps, await inbound(h, '取消', 'w1'))
    expect((await confirmNext(h, 'confirm_booking_cancel')).output).toMatchObject({ cancelled: true })
    expect(h.booking.texts).toHaveLength(1)
    expect(h.booking.texts[0].text).toBe(withDisclosure(cancelledText(target), disclosure))
    expect(h.booking.texts[0].text.endsWith(disclosure)).toBe(true)
  })
})

describe('AC-F10 today’s bookings already past are not upcoming', () => {
  it('AC-F10 today 12:00 booking at 21:00 HK → not listed, not changeable, not cancellable', async () => {
    const h = harness()
    h.clock.advance(3 * 3_600_000) // 13:00Z = 21:00 Hong Kong
    const past = await seedBooking(h, { bookingDate: '2026-11-19', bookingTime: '12:00', status: 'confirmed', decidedAt: '2026-11-19T01:00:00.000Z' })
    const later = await seedBooking(h, { bookingDate: '2026-11-19', bookingTime: '21:00' })
    const outputs: AgentToolOutput[] = []
    const ref = past.id.slice(0, 8)
    h.model.results = [
      async (req) => {
        outputs.push(await req.executeTool('list_my_bookings', {}))
        outputs.push(await req.executeTool('propose_booking_change', { bookingRef: ref, time: '22:00' }))
        outputs.push(await req.executeTool('propose_booking_cancel', { bookingRef: ref }))
        return okModel('x', ['list_my_bookings', 'propose_booking_change', 'propose_booking_cancel'])
      },
    ]
    await processAgentReply(h.deps, await inbound(h, '我嘅訂座', 'w1'))
    expect((outputs[0] as { bookings: Array<{ ref: string }> }).bookings.map((b) => b.ref)).toEqual([later.id.slice(0, 8)])
    expect(outputs[1]).toMatchObject({ error: 'not_found' })
    expect(outputs[2]).toMatchObject({ error: 'not_found' })
    // The store itself refuses it too (the repository's upcoming filter in the UPDATE).
    expect(await h.booking.requests.cancelByDiner({ restaurantId: R, phone: PHONE, id: past.id, from: { date: '2026-11-19', time: '21:00' }, at: h.clock.now() })).toEqual([])
    expect(past.status).toBe('confirmed')
  })

  it('AC-F10 a booking that passed between propose and confirm → not cancelled', async () => {
    const h = harness()
    const soon = await seedBooking(h, { bookingDate: '2026-11-19', bookingTime: '18:20', status: 'confirmed', decidedAt: '2026-11-19T01:00:00.000Z' })
    h.model.results = [callsTool('propose_booking_cancel', { bookingRef: soon.id.slice(0, 8) }, '取消 18:20，確定？')]
    await processAgentReply(h.deps, await inbound(h, '取消', 'w1'))
    h.clock.advance(20 * 60_000) // the "好" job runs at 18:21 HK, inside the proposal's 30 min
    const { output } = await confirmNext(h, 'confirm_booking_cancel')
    expect(output).toMatchObject({ error: 'not_found' })
    expect(soon.status).toBe('confirmed')
    expect(h.booking.texts).toEqual([])
  })
})
