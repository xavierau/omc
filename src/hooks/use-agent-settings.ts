'use client'

/**
 * AGENT-001 W2: the admin agent settings form state and its save call.
 * The form keeps numbers as strings; the payload sends a number only when the
 * field holds one (an empty or broken field is left out, so the stored value
 * stays). The server clamps and reports what it changed (`adjusted`). The
 * save carries the rev the form was loaded with; a 409 means someone else
 * saved meanwhile.
 */
import { useState } from 'react'
import {
  AGENT_NUMBER_RANGES,
  AGENT_TOOL_NAMES,
  type AgentConfig,
  type AgentFailureAction,
  type AgentMode,
  type AgentToolName,
} from '@/domain/value-objects/agent-config'

export type AgentNumberKnob = keyof typeof AGENT_NUMBER_RANGES
export const AGENT_NUMBER_KNOBS = Object.keys(AGENT_NUMBER_RANGES) as AgentNumberKnob[]

export interface AgentSettingsForm {
  mode: AgentMode
  knowledge: string
  instructions: string
  disclosureText: string
  model: string
  /** AGENT-003 R18: '' = env / default fallback. */
  fallbackModel: string
  /** AGENT-003 R19. */
  failureAction: AgentFailureAction
  enabledTools: AgentToolName[]
  numbers: Record<AgentNumberKnob, string>
}

export type SaveAgentSettingsOutcome =
  | { kind: 'saved'; config: AgentConfig; rev: number; adjusted: string[] }
  | { kind: 'stale' }
  | { kind: 'forbidden' }
  | { kind: 'error' }

export function toAgentForm(config: AgentConfig): AgentSettingsForm {
  return {
    mode: config.mode,
    knowledge: config.knowledge,
    instructions: config.instructions,
    disclosureText: config.disclosureText,
    model: config.model ?? '',
    fallbackModel: config.fallbackModel ?? '',
    failureAction: config.failureAction,
    enabledTools: [...config.enabledTools],
    numbers: Object.fromEntries(AGENT_NUMBER_KNOBS.map((k) => [k, String(config[k])])) as Record<AgentNumberKnob, string>,
  }
}

function toNumber(value: string): number | undefined {
  const trimmed = value.trim()
  if (trimmed === '') return undefined
  const n = Number(trimmed)
  return Number.isFinite(n) ? n : undefined
}

export function toAgentPayload(form: AgentSettingsForm, rev: number): { rev: number; config: Record<string, unknown> } {
  return {
    rev,
    config: {
      mode: form.mode,
      knowledge: form.knowledge,
      instructions: form.instructions,
      disclosureText: form.disclosureText,
      model: form.model.trim() === '' ? null : form.model.trim(),
      fallbackModel: form.fallbackModel.trim() === '' ? null : form.fallbackModel.trim(),
      failureAction: form.failureAction,
      enabledTools: AGENT_TOOL_NAMES.filter((name) => form.enabledTools.includes(name)),
      ...Object.fromEntries(AGENT_NUMBER_KNOBS.map((k) => [k, toNumber(form.numbers[k])])),
    },
  }
}

export function agentSaveOutcome(status: number, body: unknown): SaveAgentSettingsOutcome {
  const b = (body && typeof body === 'object' ? body : {}) as { config?: AgentConfig; rev?: number; adjusted?: string[] }
  if (status === 200 && b.config && typeof b.rev === 'number') {
    return { kind: 'saved', config: b.config, rev: b.rev, adjusted: Array.isArray(b.adjusted) ? b.adjusted : [] }
  }
  if (status === 409) return { kind: 'stale' }
  if (status === 403) return { kind: 'forbidden' }
  return { kind: 'error' }
}

export async function saveAgentSettings(form: AgentSettingsForm, rev: number): Promise<SaveAgentSettingsOutcome> {
  try {
    const res = await fetch('/api/dashboard/settings/agent', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(toAgentPayload(form, rev)),
    })
    return agentSaveOutcome(res.status, await res.json().catch(() => null))
  } catch {
    return { kind: 'error' }
  }
}

export function useAgentSettings(initial: AgentConfig, initialRev: number) {
  const [form, setForm] = useState<AgentSettingsForm>(() => toAgentForm(initial))
  const [rev, setRev] = useState(initialRev)
  const [outcome, setOutcome] = useState<SaveAgentSettingsOutcome | null>(null)
  const [saving, setSaving] = useState(false)

  function update<K extends keyof AgentSettingsForm>(key: K, value: AgentSettingsForm[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
    setOutcome(null)
  }

  function updateNumber(knob: AgentNumberKnob, value: string) {
    setForm((prev) => ({ ...prev, numbers: { ...prev.numbers, [knob]: value } }))
    setOutcome(null)
  }

  function toggleTool(name: AgentToolName, on: boolean) {
    setForm((prev) => ({
      ...prev,
      enabledTools: on ? [...new Set([...prev.enabledTools, name])] : prev.enabledTools.filter((t) => t !== name),
    }))
    setOutcome(null)
  }

  async function save() {
    setSaving(true)
    const result = await saveAgentSettings(form, rev)
    if (result.kind === 'saved') {
      setForm(toAgentForm(result.config))
      setRev(result.rev)
    }
    setOutcome(result)
    setSaving(false)
  }

  return { form, update, updateNumber, toggleTool, save, saving, outcome }
}
