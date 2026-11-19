/**
 * AGENT-001: the LLM behind the reply agent.
 *
 * `respond` runs the whole tool loop (≤ `maxToolCalls` tool rounds) and
 * returns a Result, never `T | null` and never a throw: the worker must know
 * WHY a run produced no reply (timeout vs safety block vs tool cap) to record
 * the outcome and, in auto mode, send the fallback menu (R4).
 *
 * Tools are executed through `executeTool`, which the worker binds to the
 * job's own restaurant and phone (R2) and to the tenant's enabled tools (R3).
 * The adapter never sees a phone, member id or restaurant id.
 */

/** `truncated`: the answer hit maxOutputTokens (cut off mid-sentence), never sent. */
export type AgentModelFailure = 'timeout' | 'http' | 'safety' | 'parse' | 'empty' | 'tool_cap' | 'truncated'

export interface AgentTurn {
  role: 'user' | 'model'
  text: string
}

/** AGENT-003: a tool's arguments as a Gemini (OpenAPI subset) object schema. */
export interface AgentToolParameters {
  type: 'object'
  properties: Record<string, { type: 'string' | 'integer'; description: string }>
  required: string[]
}

export interface AgentToolDeclaration {
  name: string
  description: string
  /** Absent: the tool takes no arguments (every AGENT-001 tool). */
  parameters?: AgentToolParameters
}

/** The JSON object returned to the model as the tool's functionResponse. */
export type AgentToolOutput = Record<string, unknown>
export type AgentToolExecutor = (name: string, args: Record<string, unknown>) => Promise<AgentToolOutput>

export interface AgentModelRequest {
  model: string
  /**
   * R18: tried once when `model` failed twice with 429/5xx/timeout; null or
   * equal to `model` → no fallback. Every attempt stays inside `budgetMs`.
   */
  fallbackModel: string | null
  systemInstruction: string
  /** Chronological, starts and ends with a user turn. */
  history: AgentTurn[]
  tools: AgentToolDeclaration[]
  executeTool: AgentToolExecutor
  temperature: number
  maxOutputTokens: number
  maxToolCalls: number
  /** Hard timeout of each generateContent call. */
  perCallTimeoutMs: number
  /** Wall-clock budget for the whole loop; past it the run fails with `timeout`. */
  budgetMs: number
}

export interface AgentModelUsage {
  promptTokens: number
  outputTokens: number
}

/**
 * Tool names called, in order (names only, never args or results: R9).
 * R18: `model` is the model that answered last (the fallback once it was
 * used); `httpStatus` is the status of the last HTTP response, absent when
 * none arrived (timeout, network). Both optional so a scripted port can omit
 * them: the worker then records the requested model.
 */
export type AgentModelResult =
  | { ok: true; text: string; toolCalls: string[]; usage: AgentModelUsage; model?: string; httpStatus?: number }
  | {
      ok: false
      reason: AgentModelFailure
      toolCalls: string[]
      usage: AgentModelUsage
      model?: string
      httpStatus?: number
    }

export interface AgentModelPort {
  respond(request: AgentModelRequest): Promise<AgentModelResult>
}
