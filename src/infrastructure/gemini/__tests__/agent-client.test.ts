// AGENT-001 W1: the Gemini generateContent adapter and its tool loop (AC-R3, AC-R4, R8).
import { describe, it, expect, vi } from 'vitest'
import { createGeminiAgentClient, generateContentUrl } from '../agent-client'
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
      generationConfig: { temperature: 0.3, maxOutputTokens: 400 },
    })
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
    expect(result).toEqual({ ok: true, text: 'You have 120 points.', toolCalls: ['get_member_summary'], usage: { promptTokens: 90, outputTokens: 23 } })
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

  it('AC-R3 maxToolCalls 0 → any tool call is a tool_cap failure and runs nothing', async () => {
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
    ['only thoughts', [{ body: { candidates: [{ content: { parts: [{ text: 'thinking', thought: true }] }, finishReason: 'MAX_TOKENS' }] } }], 'empty'],
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
