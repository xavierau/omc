// AGENT-001 W1: AgentConfig resolver (AC-VO).
import { describe, it, expect } from 'vitest'
import {
  AGENT_NUMBER_RANGES,
  DEFAULT_AGENT_CONFIG,
  DEFAULT_DISCLOSURE_TEXT,
  effectiveAgentModel,
  resolveAgentConfig,
} from '../agent-config'

describe('AC-VO AgentConfig resolver', () => {
  it.each([undefined, null, 'garbage', 42, true, [], ['mode', 'auto'], '{"mode":"auto"}'])(
    'AC-VO %j → the defaults (mode off)',
    (raw) => {
      expect(resolveAgentConfig(raw)).toEqual(DEFAULT_AGENT_CONFIG)
    }
  )

  it('AC-VO the migration default {"mode":"off"} resolves to every documented default', () => {
    expect(resolveAgentConfig({ mode: 'off' })).toEqual({
      mode: 'off',
      model: null,
      fallbackModel: null,
      knowledge: '',
      instructions: '',
      temperature: 0.3,
      maxOutputTokens: 400,
      maxReplyChars: 600,
      maxHistoryMessages: 10,
      historyTtlHours: 72,
      debounceMs: 3000,
      maxToolCalls: 3,
      enabledTools: [
        'get_member_summary',
        'list_rewards',
        'handoff_to_staff',
        'propose_booking',
        'create_booking_request',
        'get_booking_link',
      ],
      handoffSilenceHours: 12,
      maxRepliesPerPhonePerHour: 10,
      maxRepliesPerTenantPerDay: 500,
      disclosureText: DEFAULT_DISCLOSURE_TEXT,
    })
  })

  it('AC-VO partial JSON keeps what is valid and defaults the rest', () => {
    const c = resolveAgentConfig({ mode: 'shadow', knowledge: 'Open 11am-10pm', temperature: 0.5, rev: 4, extra: 'x' })
    expect(c).toEqual({ ...DEFAULT_AGENT_CONFIG, mode: 'shadow', knowledge: 'Open 11am-10pm', temperature: 0.5 })
  })

  it('AC-VO an unknown mode resolves to off', () => {
    expect(resolveAgentConfig({ mode: 'AUTO' }).mode).toBe('off')
    expect(resolveAgentConfig({ mode: 'on' }).mode).toBe('off')
  })

  it.each(Object.entries(AGENT_NUMBER_RANGES))('AC-VO %s is clamped to [min, max]', (knob, range) => {
    const low = resolveAgentConfig({ [knob]: range.min - 1000 }) as unknown as Record<string, number>
    const high = resolveAgentConfig({ [knob]: range.max + 1e9 }) as unknown as Record<string, number>
    expect(low[knob]).toBe(range.min)
    expect(high[knob]).toBe(range.max)
  })

  it.each([NaN, Infinity, -Infinity, '10', null, {}])('AC-VO a non-finite / non-number %j falls back to the default', (bad) => {
    const c = resolveAgentConfig({ maxReplyChars: bad, temperature: bad, debounceMs: bad })
    expect(c.maxReplyChars).toBe(600)
    expect(c.temperature).toBe(0.3)
    expect(c.debounceMs).toBe(3000)
  })

  it('AC-VO integer knobs are rounded; temperature keeps its fraction', () => {
    const c = resolveAgentConfig({ maxHistoryMessages: 4.6, temperature: 0.45 })
    expect(c.maxHistoryMessages).toBe(5)
    expect(c.temperature).toBe(0.45)
  })

  it('AC-VO knowledge ≤ 8000 and instructions ≤ 2000 chars; non-strings → empty', () => {
    const c = resolveAgentConfig({ knowledge: 'k'.repeat(9000), instructions: 'i'.repeat(3000) })
    expect(c.knowledge).toHaveLength(8000)
    expect(c.instructions).toHaveLength(2000)
    expect(resolveAgentConfig({ knowledge: 5, instructions: ['x'] })).toMatchObject({ knowledge: '', instructions: '' })
  })

  it('AC-VO enabledTools keeps only known tool names, deduped; a non-array keeps the default set; [] is allowed', () => {
    expect(resolveAgentConfig({ enabledTools: ['list_rewards', 'award_points', 'list_rewards', 7] }).enabledTools).toEqual(['list_rewards'])
    expect(resolveAgentConfig({ enabledTools: 'list_rewards' }).enabledTools).toEqual(DEFAULT_AGENT_CONFIG.enabledTools)
    expect(resolveAgentConfig({ enabledTools: [] }).enabledTools).toEqual([])
  })

  it('AC-VO disclosureText can be reworded (trimmed, ≤ 80) but never removed', () => {
    expect(resolveAgentConfig({ disclosureText: '  AI reply  ' }).disclosureText).toBe('AI reply')
    expect(resolveAgentConfig({ disclosureText: '' }).disclosureText).toBe(DEFAULT_DISCLOSURE_TEXT)
    expect(resolveAgentConfig({ disclosureText: '   ' }).disclosureText).toBe(DEFAULT_DISCLOSURE_TEXT)
    expect(resolveAgentConfig({ disclosureText: null }).disclosureText).toBe(DEFAULT_DISCLOSURE_TEXT)
    expect(resolveAgentConfig({ disclosureText: 'd'.repeat(200) }).disclosureText).toHaveLength(80)
  })

  it('AC-VO model accepts only a plain model id (it goes into the URL path)', () => {
    expect(resolveAgentConfig({ model: 'gemini-3.5-flash' }).model).toBe('gemini-3.5-flash')
    for (const bad of ['../decisions', 'gemini?key=x', 'Gemini', '', 'a b', 'x'.repeat(65), 3]) {
      expect(resolveAgentConfig({ model: bad }).model).toBeNull()
    }
  })

  it('AC-VO effective model: tenant pin → env AGENT_MODEL → gemini-3.8-flash', () => {
    expect(effectiveAgentModel(resolveAgentConfig({ model: 'gemini-3.5-flash' }), 'gemini-3.7-flash')).toBe('gemini-3.5-flash')
    expect(effectiveAgentModel(resolveAgentConfig({}), 'gemini-3.7-flash')).toBe('gemini-3.7-flash')
    expect(effectiveAgentModel(resolveAgentConfig({}), undefined)).toBe('gemini-3.8-flash')
    expect(effectiveAgentModel(resolveAgentConfig({}), 'bad/model')).toBe('gemini-3.8-flash')
  })

  it('AC-VO never throws on hostile input', () => {
    const hostile = Object.create({ mode: 'auto' })
    Object.defineProperty(hostile, 'knowledge', { get: () => 'x', enumerable: true })
    expect(() => resolveAgentConfig(hostile)).not.toThrow()
    expect(() => resolveAgentConfig({ enabledTools: { length: 3 } })).not.toThrow()
  })
})
