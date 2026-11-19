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

export interface AgentToolDeclaration {
  name: string
  description: string
}

/** The JSON object returned to the model as the tool's functionResponse. */
export type AgentToolOutput = Record<string, unknown>
export type AgentToolExecutor = (name: string, args: Record<string, unknown>) => Promise<AgentToolOutput>

export interface AgentModelRequest {
  model: string
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

/** Tool names called, in order (names only, never args or results: R9). */
export type AgentModelResult =
  | { ok: true; text: string; toolCalls: string[]; usage: AgentModelUsage }
  | { ok: false; reason: AgentModelFailure; toolCalls: string[]; usage: AgentModelUsage }

export interface AgentModelPort {
  respond(request: AgentModelRequest): Promise<AgentModelResult>
}
