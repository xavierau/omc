// AGENT-001 W1: the Gemini generateContent adapter and its tool loop (AC-R3, AC-R4, R8).
import { describe, it, expect, vi } from 'vitest'
import { createGeminiAgentClient, FALLBACK_RESERVE_MS, generateContentUrl } from '../agent-client'
import type { AgentModelRequest, AgentToolExecutor } from '@/domain/ports/agent-model'

const KEY = 'AIza-test-key'

type Reply = { status?: number; body?: unknown; raw?: string } | 'abort' | 'network'

function fetchSequence(replies: Reply[]) {
  const requests: Array<{ url: string; init: RequestInit; body: Record<string, unknown> }> = []
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(url), init: init as RequestInit, body: JSON.parse(String(init?.body)) })
    const reply = replies.length > 1 ? replies.shift()! : replies[0]
    if (reply === 'network') throw new TypeError('fetch failed')
    if (reply === 'abort') {
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      })
    }
    return new Response(reply.raw ?? JSON.stringify(reply.body), { status: reply.status ?? 200 })
  })
  return { fetchImpl: fetchImpl as unknown as typeof fetch, requests }
}

const textReply = (text: string) => ({
  body: {
    candidates: [{ content: { role: 'model', parts: [{ text }] }, finishReason: 'STOP' }],
    usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 10, thoughtsTokenCount: 5 },
  },
})

const callReply = (name: string, id = `call_${name}`, args: unknown = {}) => ({
  body: {
    candidates: [
      {
        content: { role: 'model', parts: [{ functionCall: { id, name, args }, thoughtSignature: 'sig-abc' }] },
        finishReason: 'STOP',
      },
    ],
    usageMetadata: { promptTokenCount: 40, candidatesTokenCount: 8 },
  },
})

function request(overrides: Partial<AgentModelRequest> = {}): AgentModelRequest {
  return {
    model: 'gemini-3.8-flash',
    fallbackModel: null,
    systemInstruction: 'SYSTEM',
    history: [{ role: 'user', text: 'How many points do I have?' }],
    tools: [{ name: 'get_member_summary', description: 'd' }],
    executeTool: async () => ({ member: true, pointsBalance: 120 }),
    temperature: 0.3,
    maxOutputTokens: 400,
    maxToolCalls: 3,
    perCallTimeoutMs: 8000,
    budgetMs: 20000,
    ...overrides,
  }
}

describe('request contract', () => {
  it('posts to models/<model>:generateContent with the key in x-goog-api-key, never the URL', async () => {
    const { fetchImpl, requests } = fetchSequence([textReply('Hi')])
    const client = createGeminiAgentClient({ fetchImpl, getApiKey: () => KEY })
    await client.respond(request())
    expect(requests[0].url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent')
    expect(requests[0].url).not.toContain(KEY)
    expect((requests[0].init.headers as Record<string, string>)['x-goog-api-key']).toBe(KEY)
    expect(requests[0].body).toEqual({
      systemInstruction: { parts: [{ text: 'SYSTEM' }] },
      contents: [{ role: 'user', parts: [{ text: 'How many points do I have?' }] }],
      tools: [{ functionDeclarations: [{ name: 'get_member_summary', description: 'd', parameters: { type: 'object', properties: {} } }] }],
      generationConfig: { temperature: 0.3, maxOutputTokens: 400, thinkingConfig: { thinkingLevel: 'low' } },
    })
  })

  it('AC-F5 every request carries the lowest thinking level the default model supports (low)', async () => {
    const { fetchImpl, requests } = fetchSequence([callReply('get_member_summary'), textReply('ok')])
    await createGeminiAgentClient({ fetchImpl, getApiKey: () => KEY }).respond(request())
    expect(requests).toHaveLength(2)
    for (const r of requests) expect((r.body.generationConfig as Record<string, unknown>).thinkingConfig).toEqual({ thinkingLevel: 'low' })
  })

  it('omits tools when none are enabled and encodes the model id', async () => {
    const { fetchImpl, requests } = fetchSequence([textReply('Hi')])
    await createGeminiAgentClient({ fetchImpl, getApiKey: () => KEY }).respond(request({ tools: [] }))
    expect(requests[0].body.tools).toBeUndefined()
    expect(generateContentUrl('a/b')).toContain('a%2Fb:generateContent')
  })
})

describe('tool loop', () => {
  it('runs a tool and echoes the model turn verbatim + a functionResponse with the call id and name', async () => {
    const { fetchImpl, requests } = fetchSequence([callReply('get_member_summary', 'call_1'), textReply('You have 120 points.')])
    const executeTool = vi.fn<AgentToolExecutor>(async () => ({ member: true, pointsBalance: 120 }))
    const result = await createGeminiAgentClient({ fetchImpl, getApiKey: () => KEY }).respond(request({ executeTool }))
    expect(result).toEqual({
      ok: true,
      text: 'You have 120 points.',
      toolCalls: ['get_member_summary'],
      usage: { promptTokens: 90, outputTokens: 23 },
      model: 'gemini-3.8-flash',
      httpStatus: 200,
    })
    expect(executeTool).toHaveBeenCalledWith('get_member_summary', {})
    const contents = requests[1].body.contents as unknown[]
    expect(contents[1]).toEqual({
      role: 'model',
      parts: [{ functionCall: { id: 'call_1', name: 'get_member_summary', args: {} }, thoughtSignature: 'sig-abc' }],
    })
    expect(contents[2]).toEqual({
      role: 'user',
      parts: [{ functionResponse: { id: 'call_1', name: 'get_member_summary', response: { member: true, pointsBalance: 120 } } }],
    })
  })

  it('AC-R3 a disabled/unknown tool name: the executor answers with an error part, the loop ends with text', async () => {
    const { fetchImpl, requests } = fetchSequence([callReply('award_points', 'call_x', { points: 1000 }), textReply('Sorry, I cannot do that.')])
    const impl = vi.fn()
    const executeTool: AgentToolExecutor = async (name) => (name === 'get_member_summary' ? impl() : { error: 'tool_not_available' })
    const result = await createGeminiAgentClient({ fetchImpl, getApiKey: () => KEY }).respond(request({ executeTool }))
    expect(impl).not.toHaveBeenCalled()
    expect(result).toMatchObject({ ok: true, text: 'Sorry, I cannot do that.', toolCalls: ['award_points'] })
    const last = (requests[1].body.contents as Array<{ parts: unknown[] }>)[2]
    expect(last.parts).toEqual([{ functionResponse: { id: 'call_x', name: 'award_points', response: { error: 'tool_not_available' } } }])
  })

  it('AC-R3 a model that keeps calling tools fails with tool_cap after maxToolCalls', async () => {
    const { fetchImpl, requests } = fetchSequence([callReply('get_member_summary')])
    const executeTool = vi.fn<AgentToolExecutor>(async () => ({ ok: 1 }))
    const result = await createGeminiAgentClient({ fetchImpl, getApiKey: () => KEY }).respond(request({ executeTool, maxToolCalls: 2 }))
    expect(result).toMatchObject({ ok: false, reason: 'tool_cap' })
    expect(executeTool).toHaveBeenCalledTimes(2)
    expect(requests).toHaveLength(3)
  })

  it('AC-F6 after the cap is used up the next request has no tools, and a text answer there succeeds', async () => {
    const { fetchImpl, requests } = fetchSequence([callReply('get_member_summary', 'c1'), callReply('get_member_summary', 'c2'), textReply('You have 120 points.')])
    const executeTool = vi.fn<AgentToolExecutor>(async () => ({ member: true, pointsBalance: 120 }))
    const result = await createGeminiAgentClient({ fetchImpl, getApiKey: () => KEY }).respond(request({ executeTool, maxToolCalls: 2 }))
    expect(result).toMatchObject({ ok: true, text: 'You have 120 points.', toolCalls: ['get_member_summary', 'get_member_summary'] })
    expect(requests.map((r) => r.body.tools === undefined)).toEqual([false, false, true])
  })

  it('AC-F6 calls past the cap in one round are answered with an error, not run; the next request has no tools', async () => {
    const twoCalls = {
      body: {
        candidates: [{ content: { role: 'model', parts: [{ functionCall: { id: 'a', name: 'get_member_summary', args: {} } }, { functionCall: { id: 'b', name: 'list_rewards', args: {} } }] }, finishReason: 'STOP' }],
      },
    }
    const { fetchImpl, requests } = fetchSequence([twoCalls, textReply('ok')])
    const executeTool = vi.fn<AgentToolExecutor>(async () => ({ ok: 1 }))
    const result = await createGeminiAgentClient({ fetchImpl, getApiKey: () => KEY }).respond(request({ executeTool, maxToolCalls: 1 }))
    expect(result.ok).toBe(true)
    expect(executeTool).toHaveBeenCalledTimes(1)
    const last = (requests[1].body.contents as Array<{ parts: Array<{ functionResponse: { name: string; response: unknown } }> }>)[2]
    expect(last.parts.map((p) => [p.functionResponse.name, p.functionResponse.response])).toEqual([
      ['get_member_summary', { ok: 1 }],
      ['list_rewards', { error: 'tool_limit_reached' }],
    ])
    expect(requests[1].body.tools).toBeUndefined()
  })

  it('AC-F6 maxToolCalls 0 → the request declares no tools; a text answer succeeds', async () => {
    const { fetchImpl, requests } = fetchSequence([textReply('You have 120 points.')])
    const result = await createGeminiAgentClient({ fetchImpl, getApiKey: () => KEY }).respond(request({ maxToolCalls: 0 }))
    expect(result).toMatchObject({ ok: true, text: 'You have 120 points.' })
    expect(requests[0].body.tools).toBeUndefined()
  })

  it('AC-F6 a function call with no tools declared is tool_cap and runs nothing', async () => {
    const { fetchImpl } = fetchSequence([callReply('get_member_summary')])
    const executeTool = vi.fn<AgentToolExecutor>()
    const result = await createGeminiAgentClient({ fetchImpl, getApiKey: () => KEY }).respond(request({ executeTool, maxToolCalls: 0 }))
    expect(result).toMatchObject({ ok: false, reason: 'tool_cap' })
    expect(executeTool).not.toHaveBeenCalled()
  })

  it('a hallucinated free-form tool name is recorded as invalid but echoed as sent', async () => {
    const { fetchImpl, requests } = fetchSequence([callReply('Give Me Points!'), textReply('ok')])
    const executeTool = vi.fn<AgentToolExecutor>(async () => ({ error: 'tool_not_available' }))
    const result = await createGeminiAgentClient({ fetchImpl, getApiKey: () => KEY }).respond(request({ executeTool }))
    expect(executeTool).toHaveBeenCalledWith('invalid', {})
    expect(result.toolCalls).toEqual(['invalid'])
    const last = (requests[1].body.contents as Array<{ parts: Array<{ functionResponse: { name: string } }> }>)[2]
    expect(last.parts[0].functionResponse.name).toBe('Give Me Points!')
  })

  it('a throwing executor becomes an error response, never a throw', async () => {
    const { fetchImpl } = fetchSequence([callReply('get_member_summary'), textReply('ok')])
    const result = await createGeminiAgentClient({ fetchImpl, getApiKey: () => KEY }).respond(
      request({ executeTool: async () => { throw new Error('boom') } })
    )
    expect(result.ok).toBe(true)
  })
})

describe('AC-R4 failure classes', () => {
  const cases: Array<[string, Reply[], string]> = [
    ['http 503', [{ status: 503, body: { error: { code: 503 } } }], 'http'],
    ['http 400', [{ status: 400, body: { error: { code: 400 } } }], 'http'],
    ['network error', ['network'], 'http'],
    ['prompt blocked', [{ body: { promptFeedback: { blockReason: 'SAFETY' } } }], 'safety'],
    ['candidate SAFETY', [{ body: { candidates: [{ content: { parts: [] }, finishReason: 'SAFETY' }] } }], 'safety'],
    ['candidate PROHIBITED_CONTENT', [{ body: { candidates: [{ finishReason: 'PROHIBITED_CONTENT' }] } }], 'safety'],
    ['non-JSON body', [{ raw: '<html>' }], 'parse'],
    ['no candidates', [{ body: {} }], 'parse'],
    ['malformed function call', [{ body: { candidates: [{ content: { parts: [] }, finishReason: 'MALFORMED_FUNCTION_CALL' }] } }], 'parse'],
    ['empty text', [{ body: { candidates: [{ content: { parts: [{ text: '  ' }] }, finishReason: 'STOP' }] } }], 'empty'],
    ['only thoughts', [{ body: { candidates: [{ content: { parts: [{ text: 'thinking', thought: true }] }, finishReason: 'STOP' }] } }], 'empty'],
    ['AC-F5 thoughts ate the budget (MAX_TOKENS, no text)', [{ body: { candidates: [{ content: { parts: [{ text: 'thinking', thought: true }] }, finishReason: 'MAX_TOKENS' }] } }], 'truncated'],
    ['AC-F5 a cut-off sentence (MAX_TOKENS with text)', [{ body: { candidates: [{ content: { parts: [{ text: '你目前有 120 分，足夠換' }] }, finishReason: 'MAX_TOKENS' }] } }], 'truncated'],
  ]

  it.each(cases)('AC-R4 %s → %s', async (_label, replies, reason) => {
    const { fetchImpl } = fetchSequence(replies)
    const result = await createGeminiAgentClient({ fetchImpl, getApiKey: () => KEY }).respond(request())
    expect(result).toMatchObject({ ok: false, reason })
  })

  it('AC-R4 a hung call is aborted at perCallTimeoutMs → timeout', async () => {
    const { fetchImpl } = fetchSequence(['abort'])
    const result = await createGeminiAgentClient({ fetchImpl, getApiKey: () => KEY }).respond(request({ perCallTimeoutMs: 20 }))
    expect(result).toMatchObject({ ok: false, reason: 'timeout' })
  })

  it('AC-R4 the job budget caps the loop → timeout', async () => {
    let t = 0
    const { fetchImpl } = fetchSequence([callReply('get_member_summary')])
    const client = createGeminiAgentClient({ fetchImpl, getApiKey: () => KEY, now: () => (t += 15_000) })
    const result = await client.respond(request({ maxToolCalls: 10 }))
    expect(result).toMatchObject({ ok: false, reason: 'timeout' })
  })

  it('AC-R4 no API key → http failure, no request', async () => {
    const { fetchImpl, requests } = fetchSequence([textReply('x')])
    const result = await createGeminiAgentClient({ fetchImpl, getApiKey: () => undefined }).respond(request())
    expect(result).toMatchObject({ ok: false, reason: 'http' })
    expect(requests).toHaveLength(0)
  })
})

describe('AC-R18 overload: the fallback model first, then one retry of the main model, inside the budget', () => {
  const overloaded = { status: 503, body: { error: { code: 503, message: 'The model is overloaded.' } } }
  const FALLBACK = 'gemini-3.5-flash-lite'

  /**
   * A fake clock the sleep advances. Each request records its timeout. A reply
   * 'hang' never answers: the call takes its whole timeout and is aborted;
   * other replies take `callMs`.
   */
  function timed(replies: Array<Reply | 'hang'>, callMs = 1000) {
    let t = 0
    const requests: Array<{ model: string; timeoutMs: number }> = []
    const sleeps: number[] = []
    const queue = [...replies]
    let armed: { fn: () => void; ms: number } | null = null
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      const reply = queue.length > 1 ? queue.shift()! : queue[0]
      const model = String(url).split('/models/')[1].split(':')[0]
      const timer = armed as { fn: () => void; ms: number }
      requests.push({ model, timeoutMs: timer.ms })
      if (reply === 'hang') {
        return new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
          t += timer.ms
          queueMicrotask(timer.fn)
        })
      }
      t += callMs
      const r = reply as Exclude<Reply, 'abort' | 'network'>
      return new Response(r.raw ?? JSON.stringify(r.body), { status: r.status ?? 200 })
    }) as typeof fetch
    const client = createGeminiAgentClient({
      fetchImpl,
      getApiKey: () => KEY,
      now: () => t,
      sleep: async (ms) => void (sleeps.push(ms), (t += ms)),
      random: () => 0.5,
      schedule: (fn, ms) => {
        armed = { fn, ms }
        return () => {
          armed = null
        }
      },
    })
    return { client, requests, sleeps, elapsed: () => t }
  }

  it('AC-R18 503 → the fallback model answers at once (no pause); the result names it', async () => {
    const { client, requests, sleeps } = timed([overloaded, textReply('Hi from lite')])
    const result = await client.respond(request({ fallbackModel: FALLBACK }))
    expect(result).toMatchObject({ ok: true, text: 'Hi from lite', model: FALLBACK, httpStatus: 200 })
    expect(requests.map((r) => r.model)).toEqual(['gemini-3.8-flash', FALLBACK])
    expect(sleeps).toEqual([])
  })

  it('AC-R18 503 → fallback 503 → the main model is retried once after a jittered pause', async () => {
    const { client, requests, sleeps } = timed([overloaded, overloaded, textReply('Hi again')])
    const result = await client.respond(request({ fallbackModel: FALLBACK }))
    expect(result).toMatchObject({ ok: true, text: 'Hi again', model: 'gemini-3.8-flash' })
    expect(requests.map((r) => r.model)).toEqual(['gemini-3.8-flash', FALLBACK, 'gemini-3.8-flash'])
    expect(sleeps).toEqual([400])
  })

  it('AC-R18 the fallback stays in use for the rest of the tool loop', async () => {
    const { client, requests } = timed([overloaded, callReply('get_member_summary'), textReply('120 points')])
    const result = await client.respond(request({ fallbackModel: FALLBACK }))
    expect(result).toMatchObject({ ok: true, model: FALLBACK })
    expect(requests.map((r) => r.model)).toEqual(['gemini-3.8-flash', FALLBACK, FALLBACK])
  })

  it('AC-R18 429 and a timed-out call move on too; three failures in a row → the last failure', async () => {
    const r429 = await timed([{ status: 429, body: {} }, textReply('ok')]).client.respond(request({ fallbackModel: FALLBACK }))
    expect(r429).toMatchObject({ ok: true, model: FALLBACK })
    const { client, requests } = timed([overloaded])
    const result = await client.respond(request({ fallbackModel: FALLBACK }))
    expect(result).toMatchObject({ ok: false, reason: 'http', httpStatus: 503, model: 'gemini-3.8-flash' })
    expect(requests).toHaveLength(3)
  })

  it('AC-R18 non-overload failures (400) are not retried', async () => {
    const { client, requests } = timed([{ status: 400, body: {} }])
    expect(await client.respond(request({ fallbackModel: FALLBACK }))).toMatchObject({ ok: false, reason: 'http', httpStatus: 400 })
    expect(requests).toHaveLength(1)
  })

  it('AC-R18 no fallback configured (or the same model) → one retry of the main model only', async () => {
    for (const fallbackModel of [null, 'gemini-3.8-flash']) {
      const { client, requests } = timed([overloaded])
      expect(await client.respond(request({ fallbackModel }))).toMatchObject({ ok: false, reason: 'http' })
      expect(requests.map((r) => r.model)).toEqual(['gemini-3.8-flash', 'gemini-3.8-flash'])
    }
  })

  it('AC-R18 budget arithmetic: a hung main call at the 15 s cap still leaves the fallback its 5 s call inside 20 s', async () => {
    const { client, requests, elapsed } = timed(['hang', textReply('lite answered')])
    const result = await client.respond(request({ fallbackModel: FALLBACK, perCallTimeoutMs: 15_000, budgetMs: 20_000 }))
    expect(result).toMatchObject({ ok: true, text: 'lite answered', model: FALLBACK })
    expect(requests[0]).toEqual({ model: 'gemini-3.8-flash', timeoutMs: 15_000 })
    expect(requests[1].model).toBe(FALLBACK)
    expect(elapsed()).toBeLessThanOrEqual(20_000)
  })

  it('AC-R18 budget arithmetic: at the 8 s default a hung main call is cut at 8 s, the fallback gets 8 s, the retry what is left', async () => {
    const { client, requests, elapsed } = timed(['hang', 'hang', 'hang'])
    const result = await client.respond(request({ fallbackModel: FALLBACK, perCallTimeoutMs: 8_000, budgetMs: 20_000 }))
    expect(result).toMatchObject({ ok: false, reason: 'timeout' })
    expect(requests.map((r) => r.timeoutMs)).toEqual([8_000, 8_000, 3_600])
    expect(elapsed()).toBe(20_000)
  })

  it('AC-R18 the main call is cut to keep the fallback reserve when the cap would eat it', async () => {
    const { client, requests } = timed(['hang', textReply('ok')])
    await client.respond(request({ fallbackModel: FALLBACK, perCallTimeoutMs: 15_000, budgetMs: 18_000 }))
    expect(requests[0].timeoutMs).toBe(18_000 - FALLBACK_RESERVE_MS)
  })

  it('AC-R18 budget exhausted → timeout, no attempt past the budget', async () => {
    const { client, requests } = timed([overloaded], 10_000)
    const result = await client.respond(request({ fallbackModel: FALLBACK, budgetMs: 20_000 }))
    expect(result).toMatchObject({ ok: false, reason: 'timeout' })
    expect(requests).toHaveLength(2)
  })
})

describe('AC-F6 a mid-loop switch to the fallback model keeps the main model’s tool step verbatim', () => {
  // Live check 2026-11-19 (evidence fix1/f6-live-probe.log): gemini-3.8-flash's functionCall + thoughtSignature sent
  // VERBATIM to gemini-3.5-flash-lite and gemini-3.1-flash-lite → 200 both; the same step with the signature STRIPPED
  // → 400 "Function call is missing a thought_signature" on every model. So the switch must not strip it.
  const overloaded = { status: 503, body: { error: { code: 503, message: 'The model is overloaded.' } } }
  const FALLBACK = 'gemini-3.5-flash-lite'
  const mainStep = {
    body: {
      candidates: [
        {
          content: {
            role: 'model',
            parts: [{ functionCall: { id: 'call_1', name: 'list_rewards', args: {} }, thoughtSignature: 'sig-from-main' }],
          },
          finishReason: 'STOP',
        },
      ],
    },
  }

  it('AC-F6 tool step on the main model, follow-up 503 → the fallback request carries the step with its thoughtSignature and the tool result', async () => {
    const { fetchImpl, requests } = fetchSequence([mainStep, overloaded, textReply('We have a free coffee.')])
    const client = createGeminiAgentClient({ fetchImpl, getApiKey: () => KEY, sleep: async () => undefined })
    const result = await client.respond(
      request({
        fallbackModel: FALLBACK,
        tools: [{ name: 'list_rewards', description: 'd' }],
        executeTool: async () => ({ rewards: [{ name: 'Free coffee', pointsCost: 100 }] }),
      })
    )
    expect(result).toMatchObject({ ok: true, model: FALLBACK, toolCalls: ['list_rewards'], httpStatus: 200 })
    expect(requests.map((r) => r.url.split('/models/')[1])).toEqual([
      'gemini-3.8-flash:generateContent',
      'gemini-3.8-flash:generateContent',
      `${FALLBACK}:generateContent`,
    ])
    const switched = requests[2].body.contents as Array<{ role: string; parts: Array<Record<string, unknown>> }>
    // The fallback gets exactly what the main model's follow-up got: the step verbatim (signature kept), then the result.
    expect(switched).toEqual(requests[1].body.contents)
    expect(switched[1]).toEqual({
      role: 'model',
      parts: [{ functionCall: { id: 'call_1', name: 'list_rewards', args: {} }, thoughtSignature: 'sig-from-main' }],
    })
    expect(switched[2]).toEqual({
      role: 'user',
      parts: [{ functionResponse: { id: 'call_1', name: 'list_rewards', response: { rewards: [{ name: 'Free coffee', pointsCost: 100 }] } } }],
    })
  })
})
