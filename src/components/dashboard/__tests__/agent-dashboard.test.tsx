// AGENT-001 W2 (AC-UI support): agent settings form + conversation log render,
// payload mapping, nav wiring, and every translation key they use exists in
// en and zh-HK.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

const usedKeys = new Set<string>()
vi.mock('next-intl', () => ({
  useTranslations: (ns: string) => (key: string, vars?: Record<string, unknown>) => {
    usedKeys.add(`${ns}.${key}`)
    return vars ? `${ns}.${key}:${JSON.stringify(vars)}` : `${ns}.${key}`
  },
}))

import en from '@/messages/en.json'
import zhHK from '@/messages/zh-HK.json'
import { AgentSettingsSection, SaveFeedback } from '../agent-settings-section'
import { AgentLogState, AgentThreadList, AgentThreadPanel } from '../agent-conversation-log'
import { agentNavItem } from '../sidebar'
import { agentSaveOutcome, toAgentForm, toAgentPayload } from '@/hooks/use-agent-settings'
import { agentLogStatus } from '@/hooks/use-agent-conversations'
import { AGENT_OUTCOMES } from '@/domain/ports/agent-reply'
import { DEFAULT_AGENT_CONFIG } from '@/domain/value-objects/agent-config'

const THREAD = { key: '11111111-1111-4111-8111-111111111111', maskedPhone: '•••• 4567', lastActivityAt: '2026-11-19T10:00:05Z', messageCount: 2, latestOutcome: 'shadow_draft' as const }
const DETAIL = {
  thread: { key: THREAD.key, maskedPhone: '•••• 4567' },
  messages: [
    { id: 'm1', role: 'user' as const, text: '<img src=x onerror=alert(1)> 我有幾多分?', outcome: null, model: null, latencyMs: null, toolCalls: [], createdAt: '2026-11-19T10:00:00Z' },
    { id: 'm2', role: 'model' as const, text: '你有 120 分。', outcome: 'shadow_draft' as const, model: 'gemini-3.1-flash-lite', latencyMs: 2100, toolCalls: ['get_member_summary'], createdAt: '2026-11-19T10:00:05Z' },
  ],
}

beforeEach(() => usedKeys.clear())

function lookup(messages: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((node, part) => (node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined), messages)
}

describe('AGENT-001 W2 agent dashboard UI', () => {
  it('AC-UI reachable: the sidebar AI agent entry points at /dashboard/agent', () => {
    expect(agentNavItem((k) => `t:${k}`)).toMatchObject({ label: 't:agent', href: '/dashboard/agent' })
  })

  it('AC-UI settings section: three modes, knowledge/instructions with counters, a collapsed Advanced section with every knob', () => {
    const html = renderToStaticMarkup(<AgentSettingsSection initial={{ config: { ...DEFAULT_AGENT_CONFIG, knowledge: 'abc' }, rev: 2 }} />)
    for (const id of ['mode-off', 'mode-shadow', 'mode-auto', 'knowledge', 'instructions', 'advanced', 'disclosure', 'model', 'maxReplyChars', 'debounceMs', 'tool-handoff_to_staff', 'save']) {
      expect(html).toContain(`data-testid="agent-settings-${id}"`)
    }
    expect(html).toContain('agentSettings.charCount:{&quot;count&quot;:3,&quot;max&quot;:8000}')
    expect(html).toContain('agentSettings.charCount:{&quot;count&quot;:0,&quot;max&quot;:2000}')
    expect(html).not.toMatch(/<details[^>]*\sopen/)
  })

  it('AC-F2 the keep-conversations knob shows the resolver range 24 to 168 (min input 24)', () => {
    const html = renderToStaticMarkup(<AgentSettingsSection initial={{ config: DEFAULT_AGENT_CONFIG, rev: 0 }} />)
    const knob = html.slice(html.indexOf('id="agent-settings-historyTtlHours"'))
    const input = knob.slice(0, knob.indexOf('>'))
    expect(input).toContain('min="24"')
    expect(input).toContain('max="168"')
    expect(knob).toContain('agentSettings.range:{&quot;min&quot;:24,&quot;max&quot;:168}')
  })

  it('AC-UI settings section: a load failure shows the error state, no form', () => {
    const html = renderToStaticMarkup(<AgentSettingsSection initial={null} />)
    expect(html).toContain('data-testid="agent-settings-load-error"')
    expect(html).not.toContain('agent-settings-save')
  })

  it('AC-UI save feedback: saved (+ adjusted fields), stale with reload, forbidden, error', () => {
    expect(renderToStaticMarkup(<SaveFeedback outcome={{ kind: 'saved', config: DEFAULT_AGENT_CONFIG, rev: 3, adjusted: [] }} />)).toContain('agent-settings-saved')
    const adjusted = renderToStaticMarkup(<SaveFeedback outcome={{ kind: 'saved', config: DEFAULT_AGENT_CONFIG, rev: 3, adjusted: ['temperature'] }} />)
    expect(adjusted).toContain('data-testid="agent-settings-adjusted"')
    expect(renderToStaticMarkup(<SaveFeedback outcome={{ kind: 'stale' }} />)).toContain('agent-settings-reload')
    expect(renderToStaticMarkup(<SaveFeedback outcome={{ kind: 'forbidden' }} />)).toContain('agentSettings.forbidden')
    expect(renderToStaticMarkup(<SaveFeedback outcome={{ kind: 'error' }} />)).toContain('agentSettings.saveFailed')
  })

  it('AC-UI payload: rev + every field; blank model → null; a blank number is left out so the stored value stays', () => {
    const form = toAgentForm({ ...DEFAULT_AGENT_CONFIG, mode: 'shadow' })
    form.numbers.maxReplyChars = ''
    form.numbers.temperature = '0.7'
    const payload = toAgentPayload(form, 5)
    expect(payload.rev).toBe(5)
    expect(payload.config).toMatchObject({ mode: 'shadow', model: null, temperature: 0.7, enabledTools: DEFAULT_AGENT_CONFIG.enabledTools })
    expect(JSON.parse(JSON.stringify(payload.config))).not.toHaveProperty('maxReplyChars')
  })

  it('AC-UI AGENT-003 Advanced: fallback model field and the three booking tool checkboxes, labels in en and zh-HK', () => {
    const html = renderToStaticMarkup(<AgentSettingsSection initial={{ config: { ...DEFAULT_AGENT_CONFIG, fallbackModel: 'gemini-x-lite' }, rev: 1 }} />)
    expect(html).toContain('data-testid="agent-settings-fallback-model"')
    expect(html).toMatch(/data-testid="agent-settings-fallback-model"[^>]*value="gemini-x-lite"|value="gemini-x-lite"[^>]*data-testid="agent-settings-fallback-model"/)
    for (const name of ['propose_booking', 'create_booking_request', 'get_booking_link']) {
      expect(html).toContain(`data-testid="agent-settings-tool-${name}"`)
      for (const key of [`tool.${name}`, `toolHint.${name}`]) {
        expect(typeof lookup(en, `agentSettings.${key}`)).toBe('string')
        expect(typeof lookup(zhHK, `agentSettings.${key}`)).toBe('string')
      }
    }
    const form = toAgentForm(DEFAULT_AGENT_CONFIG)
    expect(toAgentPayload(form, 1).config.fallbackModel).toBeNull()
    form.fallbackModel = ' gemini-3.5-flash-lite '
    expect(toAgentPayload(form, 1).config.fallbackModel).toBe('gemini-3.5-flash-lite')
  })

  it('AC-UI save outcome mapping: 200 / 409 / 403 / other', () => {
    expect(agentSaveOutcome(200, { config: DEFAULT_AGENT_CONFIG, rev: 2, adjusted: ['mode'] })).toEqual({ kind: 'saved', config: DEFAULT_AGENT_CONFIG, rev: 2, adjusted: ['mode'] })
    expect(agentSaveOutcome(409, { error: 'stale', rev: 3 })).toEqual({ kind: 'stale' })
    expect(agentSaveOutcome(403, null)).toEqual({ kind: 'forbidden' })
    expect(agentSaveOutcome(500, null)).toEqual({ kind: 'error' })
    expect(agentLogStatus(403)).toBe('forbidden')
  })

  it('AC-UI conversation log: thread rows keyed by the opaque key, masked phone, outcome badge; empty state', () => {
    const html = renderToStaticMarkup(<AgentThreadList threads={[THREAD]} selectedKey={THREAD.key} onSelect={() => {}} />)
    expect(html).toContain(`data-testid="agent-log-thread-row-${THREAD.key}"`)
    expect(html).toContain('•••• 4567')
    expect(html).toContain('agentLog.outcome.shadow_draft')
    expect(renderToStaticMarkup(<AgentThreadList threads={[]} selectedKey={null} onSelect={() => {}} />)).toContain('agent-log-empty')
  })

  it('AC-UI thread detail: diner text escaped, model row with outcome, model, latency and tool names', () => {
    const html = renderToStaticMarkup(<AgentThreadPanel detail={DETAIL} status="ready" />)
    expect(html).not.toContain('<img src=x')
    expect(html).toContain('data-testid="agent-log-outcome-m2"')
    expect(html).toContain('gemini-3.1-flash-lite')
    expect(html).toContain('agentLog.latency:{&quot;ms&quot;:2100}')
    expect(html).toContain('get_member_summary')
    for (const status of ['idle', 'loading', 'not_found', 'error'] as const) {
      expect(renderToStaticMarkup(<AgentThreadPanel detail={null} status={status} />)).toContain('agent-log-detail-')
    }
    for (const status of ['loading', 'forbidden', 'error'] as const) {
      expect(renderToStaticMarkup(<AgentLogState status={status} onRetry={() => {}} />)).toMatch(/agent-log-(loading|forbidden|error)/)
    }
  })

  it('AC-UI every translation key the agent UI uses exists in en and zh-HK', () => {
    renderToStaticMarkup(<AgentSettingsSection initial={{ config: DEFAULT_AGENT_CONFIG, rev: 0 }} />)
    renderToStaticMarkup(<AgentSettingsSection initial={null} />)
    for (const outcome of [{ kind: 'saved', config: DEFAULT_AGENT_CONFIG, rev: 1, adjusted: Object.keys(DEFAULT_AGENT_CONFIG) }, { kind: 'stale' }, { kind: 'forbidden' }, { kind: 'error' }] as const) {
      renderToStaticMarkup(<SaveFeedback outcome={outcome as never} />)
    }
    renderToStaticMarkup(<AgentThreadList threads={[THREAD]} selectedKey={null} onSelect={() => {}} />)
    renderToStaticMarkup(<AgentThreadList threads={[]} selectedKey={null} onSelect={() => {}} />)
    for (const status of ['idle', 'loading', 'not_found', 'error', 'ready'] as const) {
      renderToStaticMarkup(<AgentThreadPanel detail={DETAIL} status={status} />)
    }
    for (const status of ['loading', 'forbidden', 'error'] as const) renderToStaticMarkup(<AgentLogState status={status} onRetry={() => {}} />)
    for (const outcome of AGENT_OUTCOMES) usedKeys.add(`agentLog.outcome.${outcome}`)
    usedKeys.add('nav.agent')
    usedKeys.add('agentLog.heading')
    usedKeys.add('agentLog.description')
    const missing = [...usedKeys].filter((k) => !k.startsWith('common.') && (typeof lookup(en, k) !== 'string' || typeof lookup(zhHK, k) !== 'string'))
    expect(missing).toEqual([])
    expect(usedKeys.size).toBeGreaterThan(40)
  })
})
