// BOOK-001 W2-04 / W2-05 (R9, R12): the Decisions API adapter.
import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  buildDecisionsRequest,
  createDecisionsClassifier,
  parseDecisionsResponse,
  DECISIONS_URL,
  INTENT_CRITERIA,
} from '../decisions-client'

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status })

function client(respond: (init: RequestInit) => Promise<Response>, apiKey: string | null = 'k-123') {
  const calls: Array<{ url: string; init: RequestInit }> = []
  const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    return respond(init)
  })
  const classifier = createDecisionsClassifier({ fetchImpl: fetchImpl as unknown as typeof fetch, getApiKey: () => apiKey ?? undefined })
  return { classifier, calls, fetchImpl }
}

describe('W2-05 R9: request builder', () => {
  it('has only model, input (the truncated text) and the question', () => {
    const body = buildDecisionsRequest('  想訂位  ')
    expect(Object.keys(body).sort()).toEqual(['input', 'model', 'questions'])
    expect(body.model).toBe('gemini-decision-1')
    expect(body.input).toBe('想訂位')
    expect(Object.keys(body.questions)).toEqual(['intent'])
    expect(body.questions.intent.type).toBe('choice')
  })

  it('offers exactly the four non-positional options, each described', () => {
    const { criteria } = buildDecisionsRequest('x').questions.intent
    expect(Object.keys(criteria).sort()).toEqual(['booking', 'loyalty', 'other', 'talk_to_staff'])
    for (const description of Object.values(criteria)) expect(description.length).toBeGreaterThan(20)
  })

  it('the wire request carries no phone, name, member id, restaurant name or history; key only in the header', async () => {
    const { classifier, calls } = client(async () => json(200, { answers: { intent: { choice: 'other', confidence: 0.9 } } }))
    await classifier.classify('hello')
    const { url, init } = calls[0]
    expect(url).toBe(DECISIONS_URL)
    expect(url).not.toContain('k-123')
    expect(url).not.toContain('key=')
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('k-123')
    const body = JSON.parse(String(init.body))
    expect(body).toEqual(buildDecisionsRequest('hello'))
    const wire = String(init.body)
    // The port takes only the text, so nothing else can reach the wire; check concrete values anyway.
    for (const pii of ['+852', '91234567', 'Demo Cafe', 'member-uuid', 'k-123']) expect(wire).not.toContain(pii)
    expect(Object.keys(body.questions.intent).sort()).toEqual(['criteria', 'instructions', 'type'])
    // Instructions and option text are static: the same for every diner and tenant.
    expect(JSON.stringify(body.questions.intent.criteria)).toBe(JSON.stringify(INTENT_CRITERIA))
  })

  it('cuts a 5,000-char message to ≤ 1,000 chars, never splitting a surrogate pair', () => {
    expect(buildDecisionsRequest('a'.repeat(5000)).input).toHaveLength(1000)
    const emoji = buildDecisionsRequest('a' + '😀'.repeat(3000)).input
    expect(emoji.length).toBeLessThanOrEqual(1000)
    expect(emoji.endsWith('😀')).toBe(true)
  })
})

describe('response mapping', () => {
  it('reads answers.intent.choice and confidence', () => {
    expect(parseDecisionsResponse({
      answers: { intent: { type: 'choice', choice: 'booking', probabilities: { booking: 0.83 }, confidence: 0.83 } },
      usage: { total_tokens: 100 },
    })).toEqual({ ok: true, label: 'booking', confidence: 0.83 })
  })

  it.each([
    ['no answers', {}],
    ['unknown label', { answers: { intent: { choice: 'billing', confidence: 0.9 } } }],
    ['confidence missing', { answers: { intent: { choice: 'booking' } } }],
    ['confidence out of range', { answers: { intent: { choice: 'booking', confidence: 1.4 } } }],
    ['null body', null],
  ])('%s → parse failure', (_, body) => {
    expect(parseDecisionsResponse(body)).toEqual({ ok: false, reason: 'parse' })
  })
})

describe('W2-04 R12: failures never throw', () => {
  afterEach(() => vi.useRealTimers())

  it.each<[string, () => Promise<Response>, string]>([
    ['400 safety', async () => json(400, { error: { code: 'safety', message: 'blocked' } }), 'safety'],
    ['400 prohibited_content', async () => json(400, { error: { code: 'prohibited_content' } }), 'safety'],
    ['400 limit', async () => json(400, { error: { message: 'input too long' } }), 'http_error'],
    ['429', async () => json(429, {}), 'http_error'],
    ['500', async () => json(500, {}), 'http_error'],
    ['network', async () => { throw new TypeError('fetch failed') }, 'network'],
    ['malformed JSON', async () => new Response('{nope', { status: 200 }), 'parse'],
  ])('%s → %s', async (_, respond, reason) => {
    const { classifier } = client(respond)
    expect(await classifier.classify('hi')).toEqual({ ok: false, reason })
  })

  it('missing key → no_key without a request', async () => {
    const { classifier, fetchImpl } = client(async () => json(200, {}), null)
    expect(await classifier.classify('hi')).toEqual({ ok: false, reason: 'no_key' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('aborts after 2,000 ms → timeout', async () => {
    vi.useFakeTimers()
    const { classifier } = client((init) => new Promise((_, reject) => {
      init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
    }))
    const pending = classifier.classify('hi')
    await vi.advanceTimersByTimeAsync(1999)
    let settled = false
    void pending.then(() => { settled = true })
    await Promise.resolve()
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(2)
    expect(await pending).toEqual({ ok: false, reason: 'timeout' })
  })
})
