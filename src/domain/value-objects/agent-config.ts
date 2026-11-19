/**
 * AGENT-001: a restaurant's AI reply agent settings (`restaurants.agent_config`).
 *
 * Every tunable of the agent lives here, not in code. `resolveAgentConfig`
 * never throws: the stored JSONB is resolved field by field, every number is
 * clamped to a safe range and anything malformed falls back to its default,
 * so a broken blob behaves as mode off with default knobs.
 *
 * `model` stays null unless the tenant pins one; the worker then uses env
 * `AGENT_MODEL` (fallback `DEFAULT_AGENT_MODEL`). The id goes into the
 * Gemini URL path, so only a plain model-id shape is accepted.
 */

export type AgentMode = 'off' | 'shadow' | 'auto'
export const AGENT_MODES: readonly AgentMode[] = ['off', 'shadow', 'auto']

/** The read-only tools the agent may call (R3: no write tool exists). */
export const AGENT_TOOL_NAMES = ['get_member_summary', 'list_rewards', 'handoff_to_staff'] as const
export type AgentToolName = (typeof AGENT_TOOL_NAMES)[number]

export const DEFAULT_AGENT_MODEL = 'gemini-3.8-flash'
export const DEFAULT_DISCLOSURE_TEXT = '🤖 自動回覆 Automated reply'

export const KNOWLEDGE_MAX_CHARS = 8000
export const INSTRUCTIONS_MAX_CHARS = 2000
export const DISCLOSURE_MAX_CHARS = 80
const MODEL_ID_PATTERN = /^[a-z0-9][a-z0-9.-]{0,63}$/

export interface AgentConfig {
  mode: AgentMode
  /** null → env AGENT_MODEL → DEFAULT_AGENT_MODEL. */
  model: string | null
  knowledge: string
  instructions: string
  temperature: number
  maxOutputTokens: number
  maxReplyChars: number
  maxHistoryMessages: number
  historyTtlHours: number
  debounceMs: number
  maxToolCalls: number
  enabledTools: AgentToolName[]
  handoffSilenceHours: number
  maxRepliesPerPhonePerHour: number
  maxRepliesPerTenantPerDay: number
  /** R11: appended to every auto reply; can be reworded, never removed. */
  disclosureText: string
}

interface NumberRange {
  min: number
  max: number
  integer: boolean
}

/** Safe range per numeric knob; a stored value outside it is clamped. */
export const AGENT_NUMBER_RANGES = {
  temperature: { min: 0, max: 1, integer: false },
  maxOutputTokens: { min: 64, max: 2048, integer: true },
  maxReplyChars: { min: 200, max: 1500, integer: true },
  maxHistoryMessages: { min: 1, max: 30, integer: true },
  // ≥ 24 h: the retention purge must never delete rows the 24 h tenant cap still counts (R5 vs R6).
  historyTtlHours: { min: 24, max: 168, integer: true },
  debounceMs: { min: 0, max: 15000, integer: true },
  maxToolCalls: { min: 0, max: 5, integer: true },
  handoffSilenceHours: { min: 1, max: 72, integer: true },
  maxRepliesPerPhonePerHour: { min: 1, max: 60, integer: true },
  maxRepliesPerTenantPerDay: { min: 1, max: 5000, integer: true },
} as const satisfies Record<string, NumberRange>

type NumericKnob = keyof typeof AGENT_NUMBER_RANGES

export const DEFAULT_AGENT_CONFIG: AgentConfig = {
  mode: 'off',
  model: null,
  knowledge: '',
  instructions: '',
  temperature: 0.3,
  maxOutputTokens: 400,
  maxReplyChars: 600,
  maxHistoryMessages: 10,
  historyTtlHours: 72,
  debounceMs: 3000,
  maxToolCalls: 3,
  enabledTools: [...AGENT_TOOL_NAMES],
  handoffSilenceHours: 12,
  maxRepliesPerPhonePerHour: 10,
  maxRepliesPerTenantPerDay: 500,
  disclosureText: DEFAULT_DISCLOSURE_TEXT,
}

function clampNumber(raw: unknown, knob: NumericKnob): number {
  const fallback = DEFAULT_AGENT_CONFIG[knob]
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return fallback
  const { min, max, integer } = AGENT_NUMBER_RANGES[knob]
  const value = integer ? Math.round(raw) : raw
  return Math.min(max, Math.max(min, value))
}

function boundedText(raw: unknown, max: number): string {
  return typeof raw === 'string' ? raw.slice(0, max) : ''
}

function resolveModel(raw: unknown): string | null {
  return typeof raw === 'string' && MODEL_ID_PATTERN.test(raw) ? raw : null
}

export function isAgentToolName(value: unknown): value is AgentToolName {
  return (AGENT_TOOL_NAMES as readonly unknown[]).includes(value)
}

/** A non-array keeps the default set; an array keeps only known names, deduped (empty is allowed). */
function resolveEnabledTools(raw: unknown): AgentToolName[] {
  if (!Array.isArray(raw)) return [...DEFAULT_AGENT_CONFIG.enabledTools]
  return AGENT_TOOL_NAMES.filter((name) => raw.includes(name))
}

function resolveDisclosure(raw: unknown): string {
  const text = typeof raw === 'string' ? raw.trim() : ''
  return text.length > 0 ? text.slice(0, DISCLOSURE_MAX_CHARS) : DEFAULT_DISCLOSURE_TEXT
}

export function resolveAgentConfig(raw: unknown): AgentConfig {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return structuredClone(DEFAULT_AGENT_CONFIG)
  const r = raw as Record<string, unknown>
  const numbers = Object.fromEntries(
    (Object.keys(AGENT_NUMBER_RANGES) as NumericKnob[]).map((knob) => [knob, clampNumber(r[knob], knob)])
  ) as Pick<AgentConfig, NumericKnob>
  return {
    mode: AGENT_MODES.includes(r.mode as AgentMode) ? (r.mode as AgentMode) : 'off',
    model: resolveModel(r.model),
    knowledge: boundedText(r.knowledge, KNOWLEDGE_MAX_CHARS),
    instructions: boundedText(r.instructions, INSTRUCTIONS_MAX_CHARS),
    ...numbers,
    enabledTools: resolveEnabledTools(r.enabledTools),
    disclosureText: resolveDisclosure(r.disclosureText),
  }
}

/** The model id a run uses: the tenant's pin, else env, else the default. */
export function effectiveAgentModel(config: AgentConfig, envModel: string | undefined): string {
  return config.model ?? resolveModel(envModel) ?? DEFAULT_AGENT_MODEL
}
