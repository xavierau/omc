/**
 * AGENT-001: AgentModelPort over Gemini `generateContent` (REST, no SDK).
 *
 * Contract (ai.google.dev/api/generate-content, probed 2026-11-19):
 * POST /v1beta/models/<model>:generateContent, key in `x-goog-api-key`
 * (never the URL), body `{ systemInstruction, contents, tools:
 * [{functionDeclarations}], generationConfig }`. A function call comes back
 * as a `functionCall {id, name, args}` part, often with a `thoughtSignature`;
 * the model turn is appended VERBATIM (the signature must round-trip) and
 * answered with a user turn of `functionResponse {id, name, response}` parts.
 *
 * Tools are declared only while tool calls are left (`maxToolCalls`): once
 * the cap is used up (or it is 0) the next request carries no tools, so the
 * model must answer in text; calls past the cap in one round are answered
 * with an error and not run. Omitting tools after a function-call round trip
 * was probed live on gemini-3.1-flash-lite (2026-11-19, 200 + text).
 *
 * `thinkingConfig.thinkingLevel: 'low'` keeps thoughts from eating
 * `maxOutputTokens` (ai.google.dev/gemini-api/docs/generate-content/thinking:
 * `low` is the lowest level gemini-3.8-flash supports, `minimal` is an error
 * there; 3.5 Flash and 3.1 Flash-Lite support it too). A cut-off answer
 * (finishReason MAX_TOKENS, no function call) is `truncated`, never sent.
 *
 * AGENT-003 R18, overload resilience: a call that fails with HTTP 429/5xx or
 * times out is retried once on the same model after a short jitter; if that
 * fails the same way, the run switches to `fallbackModel` for one try (and
 * stays on it for the rest of the tool loop). One retry and one fallback per
 * run, never past `budgetMs`. The result names the model that answered last
 * and the last HTTP status (a number only).
 *
 * Every failure maps to an AgentModelFailure and is never thrown. Nothing is
 * logged here: the worker logs the outcome with ids only (R8).
 */
import type {
  AgentModelFailure,
  AgentModelPort,
  AgentModelRequest,
  AgentModelResult,
  AgentModelUsage,
  AgentToolExecutor,
} from '@/domain/ports/agent-model'

export const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models'

const SAFETY_FINISH = new Set(['SAFETY', 'RECITATION', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII', 'IMAGE_SAFETY'])
const TOOL_NAME_PATTERN = /^[a-z_][a-z0-9_]{0,63}$/
/** Answer to a call past `maxToolCalls` in one round: it is not run. */
const TOOL_LIMIT_REACHED = { error: 'tool_limit_reached' }

type GeminiPart = {
  text?: string
  thought?: boolean
  functionCall?: { id?: string; name?: unknown; args?: unknown }
  [key: string]: unknown
}
type GeminiContent = { role: 'user' | 'model'; parts: GeminiPart[] }

interface GeminiResponse {
  candidates?: Array<{ content?: { role?: string; parts?: GeminiPart[] }; finishReason?: string }>
  promptFeedback?: { blockReason?: string }
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number }
}

export interface GeminiAgentClientOptions {
  fetchImpl?: typeof fetch
  getApiKey?: () => string | undefined
  now?: () => number
  /** R18: the pause before the retry (tests pass a no-op). */
  sleep?: (ms: number) => Promise<void>
  random?: () => number
}

type CallResult =
  | { ok: true; body: GeminiResponse; status: number }
  | { ok: false; reason: AgentModelFailure; status?: number }

/** R18: 200–600 ms before the one retry. */
export const RETRY_JITTER_MIN_MS = 200
export const RETRY_JITTER_SPAN_MS = 400

/** R18: overload or transient server failure (429, 5xx) or a timed-out call. */
export function isRetryable(call: CallResult): boolean {
  if (call.ok) return false
  if (call.reason === 'timeout') return true
  return call.reason === 'http' && call.status !== undefined && (call.status === 429 || call.status >= 500)
}

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export function generateContentUrl(model: string): string {
  return `${GEMINI_BASE_URL}/${encodeURIComponent(model)}:generateContent`
}

export const THINKING_LEVEL = 'low'

function requestBody(req: AgentModelRequest, contents: GeminiContent[], withTools: boolean) {
  return {
    systemInstruction: { parts: [{ text: req.systemInstruction }] },
    contents,
    ...(withTools
      ? {
          tools: [
            {
              functionDeclarations: req.tools.map((t) => ({
                name: t.name,
                description: t.description,
                parameters: t.parameters ?? { type: 'object', properties: {} },
              })),
            },
          ],
        }
      : {}),
    generationConfig: {
      temperature: req.temperature,
      maxOutputTokens: req.maxOutputTokens,
      thinkingConfig: { thinkingLevel: THINKING_LEVEL },
    },
  }
}

function addUsage(usage: AgentModelUsage, body: GeminiResponse): void {
  const meta = body.usageMetadata ?? {}
  usage.promptTokens += meta.promptTokenCount ?? 0
  usage.outputTokens += (meta.candidatesTokenCount ?? 0) + (meta.thoughtsTokenCount ?? 0)
}

/** A name safe to store and log; a hallucinated free-form name is recorded as `invalid`. */
function toolNameOf(call: { name?: unknown }): string {
  return typeof call.name === 'string' && TOOL_NAME_PATTERN.test(call.name) ? call.name : 'invalid'
}

async function runTool(execute: AgentToolExecutor, name: string, args: unknown): Promise<Record<string, unknown>> {
  try {
    const safeArgs = args && typeof args === 'object' && !Array.isArray(args) ? (args as Record<string, unknown>) : {}
    return await execute(name, safeArgs)
  } catch {
    return { error: 'tool_failed' }
  }
}

/** `name` is the sanitized name we record; `rawName` is echoed back to the model. */
interface ToolCall {
  id?: string
  name: string
  rawName: string
  args: unknown
}

type Step =
  | { kind: 'text'; text: string }
  | { kind: 'calls'; content: GeminiContent; calls: ToolCall[] }
  | { kind: 'fail'; reason: AgentModelFailure }

/** Reads one response: a final text, a round of function calls, or a failure. */
export function readStep(body: GeminiResponse): Step {
  if (body.promptFeedback?.blockReason) return { kind: 'fail', reason: 'safety' }
  const candidate = body.candidates?.[0]
  if (!candidate) return { kind: 'fail', reason: 'parse' }
  if (candidate.finishReason && SAFETY_FINISH.has(candidate.finishReason)) return { kind: 'fail', reason: 'safety' }
  const parts = Array.isArray(candidate.content?.parts) ? candidate.content.parts : []
  const calls = parts.filter((p) => p && typeof p.functionCall === 'object' && p.functionCall !== null)
  if (calls.length > 0) {
    return {
      kind: 'calls',
      content: { role: 'model', parts },
      calls: calls.map((p) => {
        const call = p.functionCall ?? {}
        return { id: call.id, name: toolNameOf(call), rawName: typeof call.name === 'string' ? call.name : '', args: call.args }
      }),
    }
  }
  if (candidate.finishReason === 'MALFORMED_FUNCTION_CALL') return { kind: 'fail', reason: 'parse' }
  if (candidate.finishReason === 'MAX_TOKENS') return { kind: 'fail', reason: 'truncated' }
  const text = parts
    .filter((p) => typeof p.text === 'string' && p.thought !== true)
    .map((p) => p.text)
    .join('')
  return text.trim() === '' ? { kind: 'fail', reason: 'empty' } : { kind: 'text', text }
}

export function createGeminiAgentClient(options: GeminiAgentClientOptions = {}): AgentModelPort {
  const fetchImpl = options.fetchImpl ?? fetch
  const getApiKey = options.getApiKey ?? (() => process.env.GEMINI_API_KEY)
  const now = options.now ?? Date.now
  const sleep = options.sleep ?? realSleep
  const random = options.random ?? Math.random

  async function callOnce(
    req: AgentModelRequest,
    model: string,
    contents: GeminiContent[],
    apiKey: string,
    timeoutMs: number,
    withTools: boolean
  ): Promise<CallResult> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const res = await fetchImpl(generateContentUrl(model), {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify(requestBody(req, contents, withTools)),
        signal: controller.signal,
      })
      if (!res.ok) return { ok: false, reason: 'http', status: res.status }
      const body = (await res.json().catch(() => undefined)) as GeminiResponse | undefined
      if (!body || typeof body !== 'object') return { ok: false, reason: 'parse', status: res.status }
      return { ok: true, body, status: res.status }
    } catch {
      return { ok: false, reason: controller.signal.aborted ? 'timeout' : 'http' }
    } finally {
      clearTimeout(timer)
    }
  }

  /** R18 state of one run: one retry, then one switch to the fallback model (sticky). */
  interface Attempts {
    model: string
    retried: boolean
    fellBack: boolean
    httpStatus?: number
  }

  /** One generateContent step with R18's retry and fallback, bounded by the run's deadline. */
  async function callResilient(
    req: AgentModelRequest,
    attempts: Attempts,
    contents: GeminiContent[],
    apiKey: string,
    deadline: number,
    withTools: boolean
  ): Promise<CallResult> {
    for (;;) {
      const remaining = deadline - now()
      if (remaining <= 0) return { ok: false, reason: 'timeout' }
      const call = await callOnce(req, attempts.model, contents, apiKey, Math.min(req.perCallTimeoutMs, remaining), withTools)
      attempts.httpStatus = call.status
      if (!isRetryable(call)) return call
      if (!attempts.retried) {
        attempts.retried = true
        const pause = Math.min(RETRY_JITTER_MIN_MS + Math.floor(random() * RETRY_JITTER_SPAN_MS), Math.max(0, deadline - now()))
        await sleep(pause)
        continue
      }
      const fallback = req.fallbackModel
      if (attempts.fellBack || !fallback || fallback === attempts.model) return call
      attempts.fellBack = true
      attempts.model = fallback
    }
  }

  return {
    async respond(req: AgentModelRequest): Promise<AgentModelResult> {
      const toolCalls: string[] = []
      const usage: AgentModelUsage = { promptTokens: 0, outputTokens: 0 }
      const attempts: Attempts = { model: req.model, retried: false, fellBack: false }
      const meta = () => ({
        model: attempts.model,
        ...(attempts.httpStatus !== undefined ? { httpStatus: attempts.httpStatus } : {}),
      })
      const fail = (reason: AgentModelFailure): AgentModelResult => ({ ok: false, reason, toolCalls, usage, ...meta() })

      // A missing key is a configuration error of the HTTP integration.
      const apiKey = getApiKey()
      if (!apiKey) return fail('http')

      const contents: GeminiContent[] = req.history.map((t) => ({ role: t.role, parts: [{ text: t.text }] }))
      const deadline = now() + req.budgetMs

      for (;;) {
        const withTools = req.tools.length > 0 && toolCalls.length < req.maxToolCalls
        const call = await callResilient(req, attempts, contents, apiKey, deadline, withTools)
        if (!call.ok) return fail(call.reason)
        addUsage(usage, call.body)

        const step = readStep(call.body)
        if (step.kind === 'fail') return fail(step.reason)
        if (step.kind === 'text') return { ok: true, text: step.text, toolCalls, usage, ...meta() }

        // A function call although no tools were declared: the model ignores the cap.
        if (!withTools) {
          toolCalls.push(...step.calls.map((c) => c.name))
          return fail('tool_cap')
        }
        contents.push(step.content)
        const responses: GeminiPart[] = []
        for (const c of step.calls) {
          const allowed = toolCalls.length < req.maxToolCalls
          toolCalls.push(c.name)
          const response = allowed ? await runTool(req.executeTool, c.name, c.args) : TOOL_LIMIT_REACHED
          responses.push({ functionResponse: { ...(c.id ? { id: c.id } : {}), name: c.rawName, response } })
        }
        contents.push({ role: 'user', parts: responses })
      }
    },
  }
}
