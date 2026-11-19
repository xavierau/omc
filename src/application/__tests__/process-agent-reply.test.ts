// AGENT-001 W1: the reply agent's worker (R4, R5, R6, R8, R9, R10, R11).
import { describe, it, expect } from 'vitest'
import { processAgentReply } from '@/application/agent/process-agent-reply'
import { admitInboundForAgent, type AgentReplyJob } from '@/application/agent/admit-inbound-for-agent'
import { DEFAULT_DISCLOSURE_TEXT, resolveAgentConfig } from '@/domain/value-objects/agent-config'
import { AGENT_OUTCOMES } from '@/domain/ports/agent-reply'
import type { AgentModelFailure } from '@/domain/ports/agent-model'
import { FakeAgentModel, failedModel, okModel, workerHarness, type WorkerHarness } from './agent-fakes'

const R = 'rest-a'
const PHONE = '+85291234567'
const KEY = { restaurantId: R, phone: PHONE }

/** Admit an inbound like the webhook does, then run the worker job it enqueued. */
async function inbound(h: WorkerHarness, text: string, wamid: string) {
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
  return jobs
}

async function runOne(h: WorkerHarness, text = '你哋幾點開門?', wamid = 'wamid.in.1') {
  const [job] = await inbound(h, text, wamid)
  return processAgentReply(h.deps, job)
}

const FAILURES: AgentModelFailure[] = ['timeout', 'http', 'safety', 'parse', 'empty', 'tool_cap', 'truncated']
const MODEL = 'gemini-3.8-flash'

/** A job for the newest stored user row, as the webhook would have enqueued it. */
async function latestJob(h: WorkerHarness, admittedMode: AgentReplyJob['admittedMode'] = 'auto'): Promise<AgentReplyJob> {
  return { restaurantId: R, phone: PHONE, messageRowId: (await h.store.latestUserMessageId(KEY)) as string, admittedMode }
}

describe('AC-R4 failure handling per class', () => {
  it.each(FAILURES)('AC-R4 auto + %s → fallback menu exactly once, outcome fallback, nothing else sent', async (reason) => {
    const h = workerHarness({ model: new FakeAgentModel([failedModel(reason)]) })
    expect(await runOne(h)).toBe('fallback')
    expect(h.fallbacks).toEqual([{ phoneNumberId: 'pn-1', phone: PHONE, restaurantId: R }])
    expect(h.sends).toEqual([])
    expect(h.store.modelRows().map((r) => r.outcome)).toEqual(['fallback'])
  })

  it.each(FAILURES)('AC-R4 shadow + %s → nothing sent, outcome error', async (reason) => {
    const h = workerHarness({ config: { mode: 'shadow' }, model: new FakeAgentModel([failedModel(reason)]) })
    expect(await runOne(h)).toBe('error')
    expect(h.fallbacks).toEqual([])
    expect(h.sends).toEqual([])
    expect(h.store.modelRows().map((r) => [r.outcome, r.text])).toEqual([['error', null]])
  })

  it('AC-R4 a model text that trims to nothing is an empty failure (auto → fallback)', async () => {
    const h = workerHarness({ model: new FakeAgentModel([okModel('   \n  ')]) })
    expect(await runOne(h)).toBe('fallback')
    expect(h.fallbacks).toHaveLength(1)
    expect(h.logs.find((l) => l.event === 'agent.reply')?.data.reason).toBe('empty')
  })

  it('AC-R4 an unexpected error in auto mode still sends the fallback once', async () => {
    const h = workerHarness()
    h.deps.messages.history = async () => {
      throw new Error('history: 57014')
    }
    expect(await runOne(h)).toBe('error')
    expect(h.fallbacks).toHaveLength(1)
    expect(h.sends).toEqual([])
  })
})

describe('AC-R6 rate limits and debounce', () => {
  it('AC-R6 the 11th message in an hour makes no model call; fallback once, then quiet', async () => {
    const h = workerHarness()
    for (let i = 1; i <= 10; i++) {
      expect(await runOne(h, `q${i}`, `wamid.${i}`)).toBe('sent')
      h.clock.advance(60_000)
    }
    expect(h.model.requests).toHaveLength(10)

    // Race past the webhook gate: the jobs reach the worker anyway.
    h.store.seed({ restaurant_id: R, phone: PHONE, role: 'user', text: 'q11', wamid: 'wamid.11' })
    const job11 = await latestJob(h)
    expect(await processAgentReply(h.deps, job11)).toBe('rate_limited')
    h.store.seed({ restaurant_id: R, phone: PHONE, role: 'user', text: 'q12', wamid: 'wamid.12' })
    const job12 = await latestJob(h)
    expect(await processAgentReply(h.deps, job12)).toBe('rate_limited')

    expect(h.model.requests).toHaveLength(10)
    expect(h.fallbacks).toHaveLength(1)
    expect(h.store.modelRows().filter((r) => r.outcome === 'rate_limited')).toHaveLength(2)
  })

  it('AC-R6 the webhook gate stops the 11th message before any job (auto)', async () => {
    const h = workerHarness()
    for (let i = 1; i <= 10; i++) await runOne(h, `q${i}`, `wamid.${i}`)
    const jobs = await inbound(h, 'q11', 'wamid.11')
    expect(jobs).toEqual([])
    expect(h.model.requests).toHaveLength(10)
  })

  it('AC-R6 two inbound inside the debounce → one model call that sees both', async () => {
    const h = workerHarness()
    const [first] = await inbound(h, '想問下', 'wamid.a')
    h.clock.advance(1_000)
    const [second] = await inbound(h, '星期日開唔開?', 'wamid.b')
    expect(await processAgentReply(h.deps, first)).toBe('superseded')
    expect(await processAgentReply(h.deps, second)).toBe('sent')
    expect(h.model.requests).toHaveLength(1)
    expect(h.model.requests[0].history).toEqual([{ role: 'user', text: '想問下\n星期日開唔開?' }])
    expect(h.store.modelRows()).toHaveLength(1)
  })

  it('AC-R6 tenant daily cap: other diners used it up → no model call for this phone', async () => {
    const h = workerHarness({ config: { mode: 'auto', maxRepliesPerTenantPerDay: 3 } })
    for (let i = 0; i < 3; i++) h.store.seed({ restaurant_id: R, phone: `+8529000000${i}`, role: 'model', outcome: 'sent', text: 'x', model: MODEL })
    h.store.seed({ restaurant_id: 'rest-b', phone: PHONE, role: 'model', outcome: 'sent', text: 'other tenant', model: MODEL })
    h.store.seed({ restaurant_id: R, phone: PHONE, role: 'user', text: 'hi', wamid: 'w' })
    const job = await latestJob(h)
    expect(await processAgentReply(h.deps, job)).toBe('rate_limited')
    expect(h.model.requests).toHaveLength(0)
  })

  it('AC-R6 rate-limited in shadow mode sends nothing', async () => {
    const h = workerHarness({ config: { mode: 'shadow', maxRepliesPerPhonePerHour: 1 } })
    h.store.seed({ restaurant_id: R, phone: PHONE, role: 'model', outcome: 'shadow_draft', text: 'x', model: MODEL })
    expect(await runOne(h)).toBe('rate_limited')
    expect(h.fallbacks).toEqual([])
    expect(h.sends).toEqual([])
  })

  it('AC-R6 calls older than the window do not count', async () => {
    const h = workerHarness({ config: { mode: 'auto', maxRepliesPerPhonePerHour: 1 } })
    h.store.seed({ restaurant_id: R, phone: PHONE, role: 'model', outcome: 'sent', text: 'x', model: MODEL, created_at: '2026-11-19T08:59:00.000Z' })
    expect(await runOne(h)).toBe('sent')
  })
})

describe('AC-R10 / AC-R11 bounded reply and disclosure', () => {
  it('AC-R10 a 5,000-char model text → sent and stored text ≤ maxReplyChars; AC-R11 send ends with the disclosure', async () => {
    const h = workerHarness({ model: new FakeAgentModel([okModel('好'.repeat(5000))]) })
    expect(await runOne(h)).toBe('sent')
    const sent = h.sends[0].text
    expect(Array.from(sent).length).toBeLessThanOrEqual(600)
    expect(sent.endsWith(`\n\n${DEFAULT_DISCLOSURE_TEXT}`)).toBe(true)
    const stored = h.store.modelRows()[0].text as string
    expect(Array.from(stored).length).toBeLessThanOrEqual(600)
    expect(sent.startsWith(stored)).toBe(true)
  })

  it('AC-R10 the shadow draft uses the same bound', async () => {
    const h = workerHarness({ config: { mode: 'shadow', maxReplyChars: 300 }, model: new FakeAgentModel([okModel('a'.repeat(5000))]) })
    await runOne(h)
    expect((h.store.modelRows()[0].text as string).length).toBeLessThanOrEqual(300)
  })

  it('AC-R11 the tenant can reword the disclosure but not remove it', async () => {
    const reworded = workerHarness({ config: { mode: 'auto', disclosureText: 'AI 助手回覆' } })
    await runOne(reworded)
    expect(reworded.sends[0].text).toBe('Hello!\n\nAI 助手回覆')
    const blank = workerHarness({ config: { mode: 'auto', disclosureText: '   ' } })
    await runOne(blank)
    expect(blank.sends[0].text).toBe(`Hello!\n\n${DEFAULT_DISCLOSURE_TEXT}`)
  })
})

describe('AC-R9 stored model row per outcome', () => {
  const expectRow = (h: WorkerHarness, expected: Record<string, unknown>) => {
    const rows = h.store.modelRows()
    expect(rows).toHaveLength(1)
    expect(AGENT_OUTCOMES).toContain(rows[0].outcome)
    expect(rows[0]).toMatchObject({ restaurant_id: R, phone: PHONE, role: 'model', wamid: null, ...expected })
  }

  it('AC-R9 sent: reply text, model id, latency, tool names only', async () => {
    const h = workerHarness({ model: new FakeAgentModel([okModel('You have 120 points.', ['get_member_summary'])]) })
    await runOne(h)
    expectRow(h, { outcome: 'sent', text: 'You have 120 points.', model: 'gemini-3.8-flash', tool_calls: ['get_member_summary'] })
    expect(h.store.modelRows()[0].latency_ms).toBeGreaterThanOrEqual(0)
  })

  it('AC-R9 shadow_draft: the draft is stored, nothing is sent', async () => {
    const h = workerHarness({ config: { mode: 'shadow' } })
    await runOne(h)
    expectRow(h, { outcome: 'shadow_draft', text: 'Hello!' })
    expect(h.sends).toEqual([])
  })

  it('AC-R9 fallback / error carry no text', async () => {
    const auto = workerHarness({ model: new FakeAgentModel([failedModel('timeout')]) })
    await runOne(auto)
    expectRow(auto, { outcome: 'fallback', text: null })
  })

  it('AC-R9 skipped when the service window is closed (draft kept for grading, nothing sent)', async () => {
    const h = workerHarness()
    h.windowOpen.value = false
    await runOne(h)
    expectRow(h, { outcome: 'skipped', text: 'Hello!' })
    expect(h.sends).toEqual([])
  })

  it('AC-R9 skipped when handed off to staff (silenced), no model call', async () => {
    const h = workerHarness({ config: { mode: 'shadow' } })
    await h.store.silenceUntil(KEY, '2026-11-19T12:00:00.000Z')
    await runOne(h)
    expectRow(h, { outcome: 'skipped', model: null })
    expect(h.model.requests).toHaveLength(0)
  })

  it('AC-R9 skipped when the tenant switched to off after a shadow job was queued (nothing sent)', async () => {
    const h = workerHarness({ config: { mode: 'shadow' } })
    const [job] = await inbound(h, 'hi', 'w1')
    h.setConfig({ mode: 'off' })
    expect(await processAgentReply(h.deps, job)).toBe('skipped')
    expect(h.model.requests).toHaveLength(0)
    expect(h.fallbacks).toEqual([])
  })

  it('AC-R9 rate_limited row has no text, model or tools', async () => {
    // shadow: the webhook does not gate, so the job reaches the worker's limit check
    const h = workerHarness({ config: { mode: 'shadow', maxRepliesPerPhonePerHour: 1 } })
    h.store.seed({ restaurant_id: R, phone: PHONE, role: 'model', outcome: 'sent', text: 'x', model: MODEL })
    await runOne(h)
    const limited = h.store.modelRows().filter((r) => r.outcome === 'rate_limited')
    expect(limited).toEqual([expect.objectContaining({ text: null, model: null, latency_ms: null, tool_calls: [] })])
  })
})

describe('AC-R5 history fed to the model', () => {
  function seedConversation(h: WorkerHarness) {
    h.store.seed({ restaurant_id: R, phone: PHONE, role: 'user', text: 'too old', wamid: 'o', created_at: '2026-11-18T09:30:00.000Z' })
    h.store.seed({ restaurant_id: R, phone: PHONE, role: 'user', text: 'u1', wamid: 'a', created_at: '2026-11-19T09:10:00.000Z' })
    h.store.seed({ restaurant_id: R, phone: PHONE, role: 'model', outcome: 'sent', text: 'm1', created_at: '2026-11-19T09:11:00.000Z' })
    h.store.seed({ restaurant_id: R, phone: PHONE, role: 'model', outcome: 'rate_limited', created_at: '2026-11-19T09:12:00.000Z' })
    h.store.seed({ restaurant_id: R, phone: PHONE, role: 'model', outcome: 'error', created_at: '2026-11-19T09:13:00.000Z' })
    h.store.seed({ restaurant_id: R, phone: PHONE, role: 'user', text: 'u2', wamid: 'b', created_at: '2026-11-19T09:20:00.000Z' })
    h.store.seed({ restaurant_id: R, phone: '+85299999999', role: 'user', text: 'other diner', wamid: 'c' })
  }

  it('AC-R5 rows inside the TTL only, chronological, replies the diner got (or would have) only, own conversation only', async () => {
    const h = workerHarness({ config: { mode: 'auto', maxHistoryMessages: 10, historyTtlHours: 24 } })
    seedConversation(h)
    await runOne(h, 'u3', 'd')
    expect(h.model.requests[0].history).toEqual([
      { role: 'user', text: 'u1' },
      { role: 'model', text: 'm1' },
      { role: 'user', text: 'u2\nu3' },
    ])
  })

  it('AC-R5 at most maxHistoryMessages rows; a window opening on a reply starts at the next diner turn', async () => {
    const h = workerHarness({ config: { mode: 'auto', maxHistoryMessages: 3, historyTtlHours: 24 } })
    seedConversation(h)
    await runOne(h, 'u3', 'd')
    // newest 3 = m1, u2, u3; the leading model turn is dropped
    expect(h.model.requests[0].history).toEqual([{ role: 'user', text: 'u2\nu3' }])
  })
})

describe('AC-R8 logs carry no text, phone or key', () => {
  it('AC-R8 a full worker run (admit, tools, send, fallback) never logs the inbound text, the phone or the key', async () => {
    const SECRET_TEXT = '我個電話係 91234567, 我對花生敏感'
    const KEY_VALUE = 'AIzaSy-test-key-should-never-appear'
    const prev = process.env.GEMINI_API_KEY
    process.env.GEMINI_API_KEY = KEY_VALUE
    try {
      const model = new FakeAgentModel([
        async (req) => {
          await req.executeTool('get_member_summary', { phone: '+85298887777' })
          await req.executeTool('handoff_to_staff', {})
          return okModel('Staff will follow up.', ['get_member_summary', 'handoff_to_staff'])
        },
        failedModel('timeout'),
      ])
      const h = workerHarness({ model })
      await runOne(h, SECRET_TEXT, 'wamid.secret')
      h.clock.advance(1000)
      h.setConfig({ mode: 'auto' })
      await h.store.silenceUntil(KEY, '2000-01-01T00:00:00.000Z')
      await runOne(h, 'second', 'wamid.secret.2')
      expect(h.logs.length).toBeGreaterThan(0)
      const serialized = JSON.stringify(h.logs)
      expect(serialized).not.toContain(SECRET_TEXT)
      expect(serialized).not.toContain('91234567')
      expect(serialized).not.toContain(PHONE)
      expect(serialized).not.toContain(PHONE.slice(1))
      expect(serialized).not.toContain('+85298887777')
      expect(serialized).not.toContain(KEY_VALUE)
      const reply = h.logs.find((l) => l.event === 'agent.reply')
      expect(reply?.data).toMatchObject({ outcome: 'sent', promptTokens: 120, outputTokens: 30, toolCalls: ['get_member_summary', 'handoff_to_staff'] })
      expect(Object.keys(reply?.data ?? {}).sort()).toEqual(
        ['latencyMs', 'messageId', 'outcome', 'outputTokens', 'promptTokens', 'restaurantId', 'toolCalls'].sort()
      )
    } finally {
      process.env.GEMINI_API_KEY = prev
    }
  })
})

describe('worker request shape', () => {
  it('passes the config knobs and the env model to the model port', async () => {
    const h = workerHarness({ config: { mode: 'auto', temperature: 0.7, maxOutputTokens: 300, maxToolCalls: 2, enabledTools: ['list_rewards'], knowledge: 'Open 11-22' } })
    h.deps.envModel = 'gemini-3.5-flash'
    await runOne(h)
    const req = h.model.requests[0]
    expect(req).toMatchObject({ model: 'gemini-3.5-flash', temperature: 0.7, maxOutputTokens: 300, maxToolCalls: 2, perCallTimeoutMs: 8000, budgetMs: 20000 })
    expect(req.tools.map((t) => t.name)).toEqual(['list_rewards'])
    expect(req.systemInstruction).toContain('Open 11-22')
    expect(resolveAgentConfig({}).mode).toBe('off')
  })
})

describe('AC-F1 overlapping jobs of one conversation', () => {
  it('AC-F1 two overlapping jobs for one conversation → exactly one send (the older job is superseded after its model call)', async () => {
    const h = workerHarness()
    const [jobA] = await inbound(h, '想問下', 'wamid.a')
    let jobBResult: unknown
    h.model.results = [
      async () => {
        // While A's model call is in flight, the diner writes again and B runs to completion.
        h.clock.advance(1_000)
        const [jobB] = await inbound(h, '星期日開唔開?', 'wamid.b')
        jobBResult = await processAgentReply(h.deps, jobB)
        return okModel('A reply')
      },
      okModel('B reply'),
    ]
    expect(await processAgentReply(h.deps, jobA)).toBe('skipped')
    expect(jobBResult).toBe('sent')
    expect(h.sends.map((s) => s.text)).toEqual([`B reply\n\n${DEFAULT_DISCLOSURE_TEXT}`])
    expect(h.fallbacks).toEqual([])
    const rows = h.store.modelRows()
    expect(rows.map((r) => r.outcome).sort()).toEqual(['sent', 'skipped'])
    // A's call still counts toward the limits.
    expect(rows.find((r) => r.outcome === 'skipped')).toMatchObject({ model: MODEL, text: null })
    expect(h.logs.find((l) => l.event === 'agent.reply' && l.data.outcome === 'skipped')?.data.reason).toBe('superseded')
  })

  it("AC-F1 a handoff silence set during job A's model call stops job B's send", async () => {
    const h = workerHarness()
    const [jobA] = await inbound(h, '我想搵職員', 'wamid.a')
    let releaseB!: () => void
    const bWaiting = new Promise<void>((resolve) => (releaseB = resolve))
    let bCalling!: () => void
    const bInCall = new Promise<void>((resolve) => (bCalling = resolve))
    let jobB: Promise<unknown> = Promise.resolve()
    h.model.results = [
      async (req) => {
        h.clock.advance(1_000)
        const [b] = await inbound(h, '喂?', 'wamid.b')
        jobB = processAgentReply(h.deps, b)
        await bInCall // B passed its start checks and is inside its model call
        await req.executeTool('handoff_to_staff', {})
        releaseB()
        return okModel('Staff will follow up.', ['handoff_to_staff'])
      },
      async () => {
        bCalling()
        await bWaiting
        return okModel('B reply')
      },
    ]
    await processAgentReply(h.deps, jobA)
    expect(await jobB).toBe('skipped')
    expect(h.sends).toEqual([])
    // R4 (ruling r2): B, admitted under auto, owes the diner the menu; A (superseded) sends nothing.
    expect(h.fallbacks).toHaveLength(1)
    expect(h.logs.filter((l) => l.event === 'agent.reply').map((l) => l.data.reason).sort()).toEqual(['silenced', 'superseded'])
    expect(h.store.modelRows().map((r) => [r.outcome, r.model])).toEqual([['skipped', MODEL], ['skipped', MODEL]])
  })

  it("AC-F1 job B silenced by job A's handoff → B sends the fallback once, A (superseded) sends nothing", async () => {
    const h = workerHarness()
    const [jobA] = await inbound(h, '我想搵職員', 'wamid.a')
    let jobB: Promise<unknown> = Promise.resolve()
    let bCalling!: () => void
    const bInCall = new Promise<void>((resolve) => (bCalling = resolve))
    let releaseB!: () => void
    const bWaiting = new Promise<void>((resolve) => (releaseB = resolve))
    h.model.results = [
      async (req) => {
        const [b] = await inbound(h, '喂?', 'wamid.b')
        jobB = processAgentReply(h.deps, b)
        await bInCall
        await req.executeTool('handoff_to_staff', {})
        releaseB()
        return okModel('Staff will follow up.', ['handoff_to_staff'])
      },
      async () => (bCalling(), await bWaiting, okModel('B reply')),
    ]
    expect(await processAgentReply(h.deps, jobA)).toBe('skipped')
    expect(await jobB).toBe('skipped')
    expect(h.sends).toEqual([])
    expect(h.fallbacks).toEqual([{ phoneNumberId: 'pn-1', phone: PHONE, restaurantId: R }])
    const reasons = h.logs.filter((l) => l.event === 'agent.reply').map((l) => [l.data.outcome, l.data.reason])
    expect(reasons.sort()).toEqual([['skipped', 'silenced'], ['skipped', 'superseded']])
  })

  it('AC-F1 an auto-admitted job silenced at job start sends the fallback once; shadow-admitted sends nothing', async () => {
    const auto = workerHarness()
    const [jobAuto] = await inbound(auto, 'hi', 'w1')
    await auto.store.silenceUntil(KEY, '2026-11-19T12:00:00.000Z')
    expect(await processAgentReply(auto.deps, jobAuto)).toBe('skipped')
    expect(auto.fallbacks).toHaveLength(1)
    expect(auto.model.requests).toHaveLength(0)
    expect(auto.logs.find((l) => l.event === 'agent.reply')?.data.reason).toBe('silenced')

    const shadow = workerHarness({ config: { mode: 'shadow' } })
    const [jobShadow] = await inbound(shadow, 'hi', 'w1')
    await shadow.store.silenceUntil(KEY, '2026-11-19T12:00:00.000Z')
    expect(await processAgentReply(shadow.deps, jobShadow)).toBe('skipped')
    expect(shadow.fallbacks).toEqual([])
  })

  it("AC-F1 a run's own handoff does not stop its own reply", async () => {
    const model = new FakeAgentModel([
      async (req) => {
        await req.executeTool('handoff_to_staff', {})
        return okModel('Staff will follow up.', ['handoff_to_staff'])
      },
    ])
    const h = workerHarness({ model })
    expect(await runOne(h)).toBe('sent')
    expect(h.sends).toHaveLength(1)
    expect(await h.store.isSilenced(KEY, h.clock.now().toISOString())).toBe(true)
  })

  it('AC-F1 a shadow draft is not recorded when the job was superseded during the model call', async () => {
    const h = workerHarness({ config: { mode: 'shadow' } })
    const [jobA] = await inbound(h, 'a', 'wamid.a')
    h.model.results = [
      async () => {
        h.store.seed({ restaurant_id: R, phone: PHONE, role: 'user', text: 'b', wamid: 'wamid.b' })
        return okModel('draft A')
      },
    ]
    expect(await processAgentReply(h.deps, jobA)).toBe('skipped')
    expect(h.store.modelRows().map((r) => [r.outcome, r.text])).toEqual([['skipped', null]])
  })
})

describe('AC-F3 config read failure and mode changes after admission', () => {
  // AGENT-003 R19: an unreadable config cannot name a failureAction, so the default (handoff) answers.
  it('AC-F3 auto-admitted job + config read error → one failure response (R19 default handoff), never read as mode off', async () => {
    const h = workerHarness()
    const [job] = await inbound(h, 'hi', 'w1')
    h.configReadable.value = false
    expect(await processAgentReply(h.deps, job)).toBe('handoff')
    expect(h.fallbacks).toHaveLength(0)
    expect(h.sends).toHaveLength(1)
    expect(h.model.requests).toHaveLength(0)
    expect(h.store.modelRows()).toEqual([expect.objectContaining({ outcome: 'handoff', model: null, reply_to_message_id: job.messageRowId })])
    expect(h.logs.find((l) => l.event === 'agent.reply')?.data.reason).toBe('config_unavailable')
  })

  it('AC-F3 shadow-admitted job + config read error → error row, nothing sent', async () => {
    const h = workerHarness({ config: { mode: 'shadow' } })
    const [job] = await inbound(h, 'hi', 'w1')
    h.configReadable.value = false
    expect(await processAgentReply(h.deps, job)).toBe('error')
    expect(h.fallbacks).toEqual([])
    expect(h.sends).toEqual([])
  })

  it('AC-F3 auto-admitted job + config now off → fallback once, outcome skipped mode_off, no model call', async () => {
    const h = workerHarness()
    const [job] = await inbound(h, 'hi', 'w1')
    h.setConfig({ mode: 'off' })
    expect(await processAgentReply(h.deps, job)).toBe('skipped')
    expect(h.fallbacks).toHaveLength(1)
    expect(h.model.requests).toHaveLength(0)
    expect(h.logs.find((l) => l.event === 'agent.reply')?.data.reason).toBe('mode_off')
  })

  it('AC-F3 the webhook stamps the admitted mode on the job', async () => {
    const auto = workerHarness()
    expect((await inbound(auto, 'hi', 'w1'))[0].admittedMode).toBe('auto')
    const shadow = workerHarness({ config: { mode: 'shadow' } })
    expect((await inbound(shadow, 'hi', 'w1'))[0].admittedMode).toBe('shadow')
  })

  it('AC-F3 auto-admitted, now shadow → draft only, plus the suppressed fallback menu once; shadow-admitted, now auto → draft only', async () => {
    const down = workerHarness()
    const [jobDown] = await inbound(down, 'hi', 'w1')
    down.setConfig({ mode: 'shadow' })
    expect(await processAgentReply(down.deps, jobDown)).toBe('shadow_draft')
    expect(down.sends).toEqual([])
    expect(down.fallbacks).toHaveLength(1)

    const up = workerHarness({ config: { mode: 'shadow' } })
    const [jobUp] = await inbound(up, 'hi', 'w1')
    up.setConfig({ mode: 'auto' })
    expect(await processAgentReply(up.deps, jobUp)).toBe('shadow_draft')
    expect(up.sends).toEqual([])
    expect(up.fallbacks).toEqual([])
  })
})

describe('AC-F4 send failure in auto', () => {
  it('AC-F4 auto send_failed → the fallback menu is tried once; outcome fallback, reason send_failed', async () => {
    const h = workerHarness()
    h.sendResult.value = { ok: false, kapsoMessageId: null, raw: null, error: { title: 'x' } }
    expect(await runOne(h)).toBe('fallback')
    expect(h.sends).toHaveLength(1)
    expect(h.fallbacks).toHaveLength(1)
    expect(h.store.modelRows()).toEqual([expect.objectContaining({ outcome: 'fallback', text: 'Hello!' })])
    expect(h.logs.find((l) => l.event === 'agent.reply')?.data.reason).toBe('send_failed')
  })

  it('AC-F4 send throws and the fallback also fails → outcome error, reason send_failed, one attempt each', async () => {
    const h = workerHarness()
    h.deps.sendText = async () => {
      throw new Error('kapso down')
    }
    h.deps.sendFallback = async (phoneNumberId, phone, restaurantId) => (h.fallbacks.push({ phoneNumberId, phone, restaurantId }), false)
    expect(await runOne(h)).toBe('error')
    expect(h.fallbacks).toHaveLength(1)
    expect(h.store.modelRows().map((r) => r.outcome)).toEqual(['error'])
  })

  it('AC-F4 no_phone_number → error, no fallback attempt', async () => {
    const h = workerHarness()
    h.deps.getPhoneNumberId = async () => null
    let fallbackCalls = 0
    h.deps.sendFallback = async () => (fallbackCalls++, true)
    expect(await runOne(h)).toBe('error')
    expect(fallbackCalls).toBe(0)
    expect(h.logs.find((l) => l.event === 'agent.reply')?.data.reason).toBe('no_phone_number')
  })
})

describe('AC-F5 truncated answers are never sent', () => {
  it('AC-F5 failure truncated → auto fallback, nothing partial sent', async () => {
    const h = workerHarness({ model: new FakeAgentModel([failedModel('truncated')]) })
    expect(await runOne(h)).toBe('fallback')
    expect(h.sends).toEqual([])
    expect(h.fallbacks).toHaveLength(1)
    expect(h.logs.find((l) => l.event === 'agent.reply')?.data.reason).toBe('truncated')
  })
})

describe('AC-F6 tools follow maxToolCalls', () => {
  it('AC-F6 maxToolCalls 0 → the model request declares no tools, so a points question gets a text answer', async () => {
    const h = workerHarness({ config: { mode: 'auto', maxToolCalls: 0 }, model: new FakeAgentModel([okModel('Please ask staff about your points.')]) })
    expect(await runOne(h, '我有幾多分?')).toBe('sent')
    expect(h.model.requests[0].tools).toEqual([])
  })
})

describe('AC-F7 a re-run of the same job sends nothing', () => {
  it('AC-F7 the same job processed twice → one send, the second run records nothing new', async () => {
    const h = workerHarness()
    const [job] = await inbound(h, 'hi', 'w1')
    expect(await processAgentReply(h.deps, job)).toBe('sent')
    const rowsAfterFirst = h.store.rows.length
    expect(await processAgentReply(h.deps, job)).toBe('duplicate')
    expect(h.sends).toHaveLength(1)
    expect(h.fallbacks).toEqual([])
    expect(h.store.rows).toHaveLength(rowsAfterFirst)
  })

  it('AC-F7 two concurrent runs of the same job (stall) → one send', async () => {
    const h = workerHarness()
    const [job] = await inbound(h, 'hi', 'w1')
    const results = await Promise.all([processAgentReply(h.deps, job), processAgentReply(h.deps, job)])
    expect(results.sort()).toEqual(['duplicate', 'sent'])
    expect(h.sends).toHaveLength(1)
    expect(h.store.modelRows()).toHaveLength(1)
  })

  it('AC-F7 the answer row is stored before the send (claim first), tied to the user row', async () => {
    const h = workerHarness()
    const [job] = await inbound(h, 'hi', 'w1')
    let rowsAtSend: unknown[] = []
    h.deps.sendText = async () => ((rowsAtSend = h.store.modelRows().map((r) => r.outcome)), h.sendResult.value)
    await processAgentReply(h.deps, job)
    expect(rowsAtSend).toEqual(['sent'])
    expect(h.store.modelRows()[0].reply_to_message_id).toBe(job.messageRowId)
  })

  it('AC-F7 a re-run of a fallback job does not send the menu twice', async () => {
    const h = workerHarness({ model: new FakeAgentModel([failedModel('timeout')]) })
    const [job] = await inbound(h, 'hi', 'w1')
    expect(await processAgentReply(h.deps, job)).toBe('fallback')
    expect(await processAgentReply(h.deps, job)).toBe('duplicate')
    expect(h.fallbacks).toHaveLength(1)
  })
})

describe('AC-F8 limits count every row that made a model call', () => {
  it('AC-F8 a window_closed skipped row with a model counts toward per-phone and per-tenant limits', async () => {
    const perPhone = workerHarness({ config: { mode: 'auto', maxRepliesPerPhonePerHour: 1 } })
    perPhone.windowOpen.value = false
    expect(await runOne(perPhone, 'q1', 'w1')).toBe('skipped')
    expect(await perPhone.store.countModelCalls(R, PHONE, '2026-11-19T09:00:00.000Z')).toBe(1)
    perPhone.clock.advance(60_000)
    perPhone.store.seed({ restaurant_id: R, phone: PHONE, role: 'user', text: 'q2', wamid: 'w2' })
    expect(await processAgentReply(perPhone.deps, await latestJob(perPhone))).toBe('rate_limited')
    expect(perPhone.model.requests).toHaveLength(1)

    const perTenant = workerHarness({ config: { mode: 'auto', maxRepliesPerTenantPerDay: 1 } })
    perTenant.store.seed({ restaurant_id: R, phone: '+85290000000', role: 'model', outcome: 'skipped', model: MODEL, text: 'x' })
    // The webhook gate already stops it (no job) …
    expect(await inbound(perTenant, 'hi', 'w1')).toEqual([])
    // … and so does the worker, for a job that raced past the gate.
    perTenant.store.seed({ restaurant_id: R, phone: PHONE, role: 'user', text: 'hi again', wamid: 'w2' })
    expect(await processAgentReply(perTenant.deps, await latestJob(perTenant))).toBe('rate_limited')
    expect(perTenant.model.requests).toHaveLength(0)
  })

  it('AC-F8 rows without a model call (rate_limited, mode_off, silenced) do not count', async () => {
    const h = workerHarness({ config: { mode: 'auto', maxRepliesPerPhonePerHour: 1 } })
    h.store.seed({ restaurant_id: R, phone: PHONE, role: 'model', outcome: 'rate_limited' })
    h.store.seed({ restaurant_id: R, phone: PHONE, role: 'model', outcome: 'skipped' })
    expect(await runOne(h)).toBe('sent')
  })
})
