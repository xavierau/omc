// AGENT-003 R19 (failure action: handoff by default) and the R18 per-call timeout knob, at the worker.
import { describe, it, expect } from 'vitest'
import { processAgentReply } from '@/application/agent/process-agent-reply'
import { admitInboundForAgent, type AgentReplyJob } from '@/application/agent/admit-inbound-for-agent'
import { DEFAULT_DISCLOSURE_TEXT, resolveAgentConfig } from '@/domain/value-objects/agent-config'
import { HANDOFF_APOLOGY } from '@/domain/services/agent-reply-text'
import { summarizeAgentThreads } from '@/domain/services/agent-conversation-log'
import type { AgentModelFailure } from '@/domain/ports/agent-model'
import { FakeAgentModel, failedModel, okModel, workerHarness, type WorkerHarness } from './agent-fakes'

const R = 'rest-a'
const PHONE = '+85291234567'
const FAILURES: AgentModelFailure[] = ['timeout', 'http', 'safety', 'parse', 'empty', 'tool_cap', 'truncated']
const CONTACT = 'Chat with us: https://wa.me/85290000000'

async function inbound(h: WorkerHarness, text = 'hi', wamid = 'wamid.1'): Promise<AgentReplyJob> {
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

function threadOf(h: WorkerHarness) {
  const rows = [...h.store.rows]
    .reverse()
    .map((r) => ({ id: r.id, phone: r.phone, role: r.role, outcome: r.outcome, createdAt: r.created_at }))
  return summarizeAgentThreads(rows)[0]
}

describe('AC-R19 auto + failureAction handoff (the default)', () => {
  it('AC-R19 the resolver defaults failureAction to handoff; junk resolves to handoff', () => {
    expect(resolveAgentConfig({}).failureAction).toBe('handoff')
    expect(resolveAgentConfig({ failureAction: 'shout' }).failureAction).toBe('handoff')
    expect(resolveAgentConfig({ failureAction: 'menu' }).failureAction).toBe('menu')
  })

  it.each(FAILURES)('AC-R19 %s → one handoff reply with the contact action, no menu, no silence row, thread needs staff', async (reason) => {
    const h = workerHarness({ config: { failureAction: 'handoff' }, model: new FakeAgentModel([failedModel(reason)]) })
    expect(await processAgentReply(h.deps, await inbound(h))).toBe('handoff')
    expect(h.fallbacks).toEqual([])
    expect(h.sends).toHaveLength(1)
    expect(h.sends[0].text).toBe(`${HANDOFF_APOLOGY}\n\n${CONTACT}\n\n${DEFAULT_DISCLOSURE_TEXT}`)
    expect(h.store.silences.size).toBe(0)
    expect(h.store.modelRows().map((r) => [r.outcome, r.text])).toEqual([['handoff', `${HANDOFF_APOLOGY}\n\n${CONTACT}`]])
    expect(threadOf(h)).toMatchObject({ needsStaff: true, latestOutcome: 'handoff' })
    expect(h.logs.find((l) => l.event === 'agent.reply')?.data).toMatchObject({ outcome: 'handoff', reason })
  })

  it('AC-R19 the agent still answers the next message (no silence): the thread stays flagged', async () => {
    const h = workerHarness({ config: { failureAction: 'handoff' }, model: new FakeAgentModel([failedModel('timeout'), okModel('Back again')]) })
    await processAgentReply(h.deps, await inbound(h, 'hi', 'w1'))
    h.clock.advance(60_000)
    expect(await processAgentReply(h.deps, await inbound(h, 'still there?', 'w2'))).toBe('sent')
    expect(h.sends.map((s) => s.text.split('\n')[0])).toEqual([HANDOFF_APOLOGY.split('\n')[0], 'Back again'])
    expect(threadOf(h).needsStaff).toBe(true)
  })

  it('AC-R19 no contact action → the apology alone', async () => {
    const h = workerHarness({ config: { failureAction: 'handoff' }, model: new FakeAgentModel([failedModel('http')]) })
    h.deps.toolData.getContactAction = async () => ({ url: null, label: null, text: null })
    await processAgentReply(h.deps, await inbound(h))
    expect(h.sends[0].text).toBe(`${HANDOFF_APOLOGY}\n\n${DEFAULT_DISCLOSURE_TEXT}`)
  })

  it('AC-R19 a handoff that cannot be sent → the menu once (still exactly one response)', async () => {
    const h = workerHarness({ config: { failureAction: 'handoff' }, model: new FakeAgentModel([failedModel('timeout')]) })
    h.sendResult.value = { ok: false, error: 'boom', raw: null } as never
    expect(await processAgentReply(h.deps, await inbound(h))).toBe('fallback')
    expect(h.sends).toHaveLength(1)
    expect(h.fallbacks).toHaveLength(1)
    expect(h.store.modelRows().map((r) => r.outcome)).toEqual(['fallback'])
  })

  it('AC-R19 a job error (throw) → one handoff reply', async () => {
    const h = workerHarness({ config: { failureAction: 'handoff' } })
    h.deps.model = { respond: async () => { throw new Error('bug') } }
    expect(await processAgentReply(h.deps, await inbound(h))).toBe('error')
    expect(h.sends).toHaveLength(1)
    expect(h.sends[0].text.startsWith(HANDOFF_APOLOGY)).toBe(true)
    expect(h.fallbacks).toEqual([])
  })

  it('AC-R19 a duplicate run of the same job sends nothing more', async () => {
    const h = workerHarness({ config: { failureAction: 'handoff' }, model: new FakeAgentModel([failedModel('http')]) })
    const job = await inbound(h)
    await processAgentReply(h.deps, job)
    expect(await processAgentReply(h.deps, job)).toBe('duplicate')
    expect(h.sends).toHaveLength(1)
  })

  it('AC-R19 shadow is unchanged: a failure records error and sends nothing', async () => {
    const h = workerHarness({ config: { mode: 'shadow', failureAction: 'handoff' }, model: new FakeAgentModel([failedModel('http')]) })
    expect(await processAgentReply(h.deps, await inbound(h))).toBe('error')
    expect(h.sends).toEqual([])
    expect(h.fallbacks).toEqual([])
  })

  it('AC-R19 non-failures keep the menu (mode switched off after admission)', async () => {
    const h = workerHarness({ config: { failureAction: 'handoff' } })
    const job = await inbound(h)
    h.setConfig({ mode: 'off', failureAction: 'handoff' })
    await processAgentReply(h.deps, job)
    expect(h.fallbacks).toHaveLength(1)
    expect(h.sends).toEqual([])
  })
})

describe('AC-R19 auto + failureAction menu', () => {
  it.each(FAILURES)('AC-R19 %s → today’s fallback menu once, no handoff text, not flagged', async (reason) => {
    const h = workerHarness({ config: { failureAction: 'menu' }, model: new FakeAgentModel([failedModel(reason)]) })
    expect(await processAgentReply(h.deps, await inbound(h))).toBe('fallback')
    expect(h.fallbacks).toHaveLength(1)
    expect(h.sends).toEqual([])
    expect(threadOf(h).needsStaff).toBe(false)
  })
})

describe('AC-R18 per-call timeout knob', () => {
  it('AC-R18 perCallTimeoutMs: default 8000, clamped 3000–15000, passed to the model call', async () => {
    const cases: Array<[Record<string, unknown>, number]> = [
      [{}, 8000],
      [{ perCallTimeoutMs: 12000 }, 12000],
      [{ perCallTimeoutMs: 99999 }, 15000],
      [{ perCallTimeoutMs: 10 }, 3000],
    ]
    for (const [config, expected] of cases) {
      const model = new FakeAgentModel([okModel('Hi')])
      const h = workerHarness({ config, model })
      await processAgentReply(h.deps, await inbound(h))
      expect(model.requests[0]).toMatchObject({ perCallTimeoutMs: expected, budgetMs: 20_000 })
    }
  })
})
