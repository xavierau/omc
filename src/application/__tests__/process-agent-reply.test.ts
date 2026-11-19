// AGENT-001 W1: the reply agent's worker (R4, R5, R6, R8, R9, R10, R11).
import { describe, it, expect } from 'vitest'
import { processAgentReply } from '@/application/agent/process-agent-reply'
import { admitInboundForAgent } from '@/application/agent/admit-inbound-for-agent'
import { DEFAULT_DISCLOSURE_TEXT, resolveAgentConfig } from '@/domain/value-objects/agent-config'
import { AGENT_OUTCOMES } from '@/domain/ports/agent-reply'
import type { AgentModelFailure } from '@/domain/ports/agent-model'
import { FakeAgentModel, failedModel, okModel, workerHarness, type WorkerHarness } from './agent-fakes'

const R = 'rest-a'
const PHONE = '+85291234567'
const KEY = { restaurantId: R, phone: PHONE }

/** Admit an inbound like the webhook does, then run the worker job it enqueued. */
async function inbound(h: WorkerHarness, text: string, wamid: string) {
  const jobs: Array<{ restaurantId: string; phone: string; messageRowId: string }> = []
  await admitInboundForAgent(
    {
      getConfig: h.deps.getConfig,
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

const FAILURES: AgentModelFailure[] = ['timeout', 'http', 'safety', 'parse', 'empty', 'tool_cap']

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
    const job11 = { restaurantId: R, phone: PHONE, messageRowId: (await h.store.latestUserMessageId(KEY)) as string }
    expect(await processAgentReply(h.deps, job11)).toBe('rate_limited')
    h.store.seed({ restaurant_id: R, phone: PHONE, role: 'user', text: 'q12', wamid: 'wamid.12' })
    const job12 = { restaurantId: R, phone: PHONE, messageRowId: (await h.store.latestUserMessageId(KEY)) as string }
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
    for (let i = 0; i < 3; i++) h.store.seed({ restaurant_id: R, phone: `+8529000000${i}`, role: 'model', outcome: 'sent', text: 'x' })
    h.store.seed({ restaurant_id: 'rest-b', phone: PHONE, role: 'model', outcome: 'sent', text: 'other tenant' })
    h.store.seed({ restaurant_id: R, phone: PHONE, role: 'user', text: 'hi', wamid: 'w' })
    const job = { restaurantId: R, phone: PHONE, messageRowId: (await h.store.latestUserMessageId(KEY)) as string }
    expect(await processAgentReply(h.deps, job)).toBe('rate_limited')
    expect(h.model.requests).toHaveLength(0)
  })

  it('AC-R6 rate-limited in shadow mode sends nothing', async () => {
    const h = workerHarness({ config: { mode: 'shadow', maxRepliesPerPhonePerHour: 1 } })
    h.store.seed({ restaurant_id: R, phone: PHONE, role: 'model', outcome: 'shadow_draft', text: 'x' })
    expect(await runOne(h)).toBe('rate_limited')
    expect(h.fallbacks).toEqual([])
    expect(h.sends).toEqual([])
  })

  it('AC-R6 calls older than the window do not count', async () => {
    const h = workerHarness({ config: { mode: 'auto', maxRepliesPerPhonePerHour: 1 } })
    h.store.seed({ restaurant_id: R, phone: PHONE, role: 'model', outcome: 'sent', text: 'x', created_at: '2026-11-19T08:59:00.000Z' })
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

  it('AC-R9 skipped when the tenant switched to off after the job was queued', async () => {
    const h = workerHarness()
    const [job] = await inbound(h, 'hi', 'w1')
    h.setConfig({ mode: 'off' })
    expect(await processAgentReply(h.deps, job)).toBe('skipped')
    expect(h.model.requests).toHaveLength(0)
  })

  it('AC-R9 error when the send fails', async () => {
    const h = workerHarness()
    h.sendResult.value = { ok: false, kapsoMessageId: null, raw: null, error: { title: 'x' } }
    await runOne(h)
    expectRow(h, { outcome: 'error', text: 'Hello!' })
    expect(h.fallbacks).toEqual([])
  })

  it('AC-R9 rate_limited row has no text, model or tools', async () => {
    // shadow: the webhook does not gate, so the job reaches the worker's limit check
    const h = workerHarness({ config: { mode: 'shadow', maxRepliesPerPhonePerHour: 1 } })
    h.store.seed({ restaurant_id: R, phone: PHONE, role: 'model', outcome: 'sent', text: 'x' })
    await runOne(h)
    const limited = h.store.modelRows().filter((r) => r.outcome === 'rate_limited')
    expect(limited).toEqual([expect.objectContaining({ text: null, model: null, latency_ms: null, tool_calls: [] })])
  })
})

describe('AC-R5 history fed to the model', () => {
  function seedConversation(h: WorkerHarness) {
    h.store.seed({ restaurant_id: R, phone: PHONE, role: 'user', text: 'too old', wamid: 'o', created_at: '2026-11-19T08:30:00.000Z' })
    h.store.seed({ restaurant_id: R, phone: PHONE, role: 'user', text: 'u1', wamid: 'a', created_at: '2026-11-19T09:10:00.000Z' })
    h.store.seed({ restaurant_id: R, phone: PHONE, role: 'model', outcome: 'sent', text: 'm1', created_at: '2026-11-19T09:11:00.000Z' })
    h.store.seed({ restaurant_id: R, phone: PHONE, role: 'model', outcome: 'rate_limited', created_at: '2026-11-19T09:12:00.000Z' })
    h.store.seed({ restaurant_id: R, phone: PHONE, role: 'model', outcome: 'error', created_at: '2026-11-19T09:13:00.000Z' })
    h.store.seed({ restaurant_id: R, phone: PHONE, role: 'user', text: 'u2', wamid: 'b', created_at: '2026-11-19T09:20:00.000Z' })
    h.store.seed({ restaurant_id: R, phone: '+85299999999', role: 'user', text: 'other diner', wamid: 'c' })
  }

  it('AC-R5 rows inside the TTL only, chronological, replies the diner got (or would have) only, own conversation only', async () => {
    const h = workerHarness({ config: { mode: 'auto', maxHistoryMessages: 10, historyTtlHours: 1 } })
    seedConversation(h)
    await runOne(h, 'u3', 'd')
    expect(h.model.requests[0].history).toEqual([
      { role: 'user', text: 'u1' },
      { role: 'model', text: 'm1' },
      { role: 'user', text: 'u2\nu3' },
    ])
  })

  it('AC-R5 at most maxHistoryMessages rows; a window opening on a reply starts at the next diner turn', async () => {
    const h = workerHarness({ config: { mode: 'auto', maxHistoryMessages: 3, historyTtlHours: 1 } })
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
