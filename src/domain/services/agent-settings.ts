/**
 * AGENT-001 W2: the settings PUT merges the admin's fields onto the stored
 * config and runs the result through `resolveAgentConfig`, so clamping and
 * defaults have one source of truth (R7). A field the resolver changed (an
 * out-of-range number, an over-long text, a blank disclosure restored to the
 * default) is reported back in `adjusted`, never dropped silently.
 */
import { DEFAULT_AGENT_CONFIG, resolveAgentConfig, type AgentConfig } from '@/domain/value-objects/agent-config'

const SETTING_KEYS = Object.keys(DEFAULT_AGENT_CONFIG) as Array<keyof AgentConfig>

export interface MergedAgentSettings {
  config: AgentConfig
  /** Submitted keys whose stored value differs from what was sent. */
  adjusted: Array<keyof AgentConfig>
}

export function isSettingsObject(input: unknown): input is Record<string, unknown> {
  return !!input && typeof input === 'object' && !Array.isArray(input)
}

export function mergeAgentSettings(current: AgentConfig, input: Record<string, unknown>): MergedAgentSettings {
  const submitted = SETTING_KEYS.filter((key) => key in input && input[key] !== undefined)
  const picked = Object.fromEntries(submitted.map((key) => [key, input[key]]))
  const config = resolveAgentConfig({ ...current, ...picked })
  const adjusted = submitted.filter((key) => JSON.stringify(input[key]) !== JSON.stringify(config[key]))
  return { config, adjusted }
}
