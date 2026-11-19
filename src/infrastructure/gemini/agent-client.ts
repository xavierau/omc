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
}

type CallResult = { ok: true; body: GeminiResponse } | { ok: false; reason: AgentModelFailure }

export function generateContentUrl(model: string): string {
  return `${GEMINI_BASE_URL}/${encodeURIComponent(model)}:generateContent`
}

function requestBody(req: AgentModelRequest, contents: GeminiContent[]) {
  return {
    systemInstruction: { parts: [{ text: req.systemInstruction }] },
    contents,
    ...(req.tools.length > 0
      ? {
          tools: [
            {
              functionDeclarations: req.tools.map((t) => ({
                name: t.name,
                description: t.description,
                parameters: { type: 'object', properties: {} },
              })),
            },
          ],
        }
      : {}),
    generationConfig: { temperature: req.temperature, maxOutputTokens: req.maxOutputTokens },
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

  async function callOnce(req: AgentModelRequest, contents: GeminiContent[], apiKey: string, timeoutMs: number): Promise<CallResult> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const res = await fetchImpl(generateContentUrl(req.model), {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify(requestBody(req, contents)),
        signal: controller.signal,
      })
      if (!res.ok) return { ok: false, reason: 'http' }
      const body = (await res.json().catch(() => undefined)) as GeminiResponse | undefined
      if (!body || typeof body !== 'object') return { ok: false, reason: 'parse' }
      return { ok: true, body }
    } catch {
      return { ok: false, reason: controller.signal.aborted ? 'timeout' : 'http' }
    } finally {
      clearTimeout(timer)
    }
  }

  return {
    async respond(req: AgentModelRequest): Promise<AgentModelResult> {
      const toolCalls: string[] = []
      const usage: AgentModelUsage = { promptTokens: 0, outputTokens: 0 }
      const fail = (reason: AgentModelFailure): AgentModelResult => ({ ok: false, reason, toolCalls, usage })

      // A missing key is a configuration error of the HTTP integration.
      const apiKey = getApiKey()
      if (!apiKey) return fail('http')

      const contents: GeminiContent[] = req.history.map((t) => ({ role: t.role, parts: [{ text: t.text }] }))
      const deadline = now() + req.budgetMs

      for (;;) {
        const remaining = deadline - now()
        if (remaining <= 0) return fail('timeout')
        const call = await callOnce(req, contents, apiKey, Math.min(req.perCallTimeoutMs, remaining))
        if (!call.ok) return fail(call.reason)
        addUsage(usage, call.body)

        const step = readStep(call.body)
        if (step.kind === 'fail') return fail(step.reason)
        if (step.kind === 'text') return { ok: true, text: step.text, toolCalls, usage }

        if (toolCalls.length + step.calls.length > req.maxToolCalls) {
          toolCalls.push(...step.calls.map((c) => c.name))
          return fail('tool_cap')
        }
        contents.push(step.content)
        const responses: GeminiPart[] = []
        for (const c of step.calls) {
          toolCalls.push(c.name)
          const response = await runTool(req.executeTool, c.name, c.args)
          responses.push({ functionResponse: { ...(c.id ? { id: c.id } : {}), name: c.rawName, response } })
        }
        contents.push({ role: 'user', parts: responses })
      }
    },
  }
}
