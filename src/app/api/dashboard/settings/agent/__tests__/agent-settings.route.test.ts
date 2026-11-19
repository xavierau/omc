// AGENT-001 W2 AC-W2-API: the agent settings API (mirrors settings/booking).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/infrastructure/supabase/guards/tenant-guard')
vi.mock('@/infrastructure/supabase/repositories/agent-config-repository')

import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'
import { getAgentSettings, saveAgentSettingsAtRev } from '@/infrastructure/supabase/repositories/agent-config-repository'
import { DEFAULT_AGENT_CONFIG, DEFAULT_DISCLOSURE_TEXT, type AgentConfig } from '@/domain/value-objects/agent-config'
import { GET, PUT } from '../route'

const RID = 'rest-1'

function req(body: unknown) {
  return new NextRequest('http://localhost/api/dashboard/settings/agent', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

function as(role: string) {
  vi.mocked(getTenantContext).mockResolvedValue({ userId: 'u-1', restaurantId: RID, role, tenantStatus: 'active' })
}

/** The repository applies the route's change to the stored config, as the real CAS does. */
function storedAt(rev: number, stored: AgentConfig = { ...DEFAULT_AGENT_CONFIG }) {
  vi.mocked(saveAgentSettingsAtRev).mockImplementation(async (_rid, expected, change) =>
    expected === rev ? { kind: 'saved', config: change(structuredClone(stored)), rev: rev + 1 } : { kind: 'stale', rev }
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getAgentSettings).mockResolvedValue({ config: { ...DEFAULT_AGENT_CONFIG, mode: 'shadow' }, rev: 3 })
  storedAt(3)
})

describe('AC-W2-API GET /api/dashboard/settings/agent', () => {
  it('AC-W2-API any tenant member gets the resolved config, its rev and canEdit=false', async () => {
    as('staff')
    const res = await GET()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ config: { ...DEFAULT_AGENT_CONFIG, mode: 'shadow' }, rev: 3, canEdit: false })
    expect(getAgentSettings).toHaveBeenCalledWith(RID)
  })

  it('AC-W2-API an admin gets canEdit=true', async () => {
    as('admin')
    expect((await (await GET()).json()).canEdit).toBe(true)
  })

  it('AC-W2-API no tenant session → the auth error status, nothing read', async () => {
    vi.mocked(getTenantContext).mockRejectedValue(new AuthError('No tenant selected', 403))
    expect((await GET()).status).toBe(403)
    expect(getAgentSettings).not.toHaveBeenCalled()
  })

  it('AC-W2-API a read failure → 500 (never defaults that a save could write back)', async () => {
    as('admin')
    vi.mocked(getAgentSettings).mockRejectedValue(new Error('boom'))
    expect((await GET()).status).toBe(500)
  })
})

describe('AC-W2-API PUT /api/dashboard/settings/agent', () => {
  it('AC-W2-API non-admin → 403 and nothing saved', async () => {
    as('staff')
    const res = await PUT(req({ rev: 3, config: { mode: 'auto' } }))
    expect(res.status).toBe(403)
    expect(saveAgentSettingsAtRev).not.toHaveBeenCalled()
  })

  it('AC-W2-API admin saves mode + knowledge at the current rev → 200 with the stored config and rev + 1', async () => {
    as('admin')
    const res = await PUT(req({ rev: 3, config: { mode: 'shadow', knowledge: 'Open 11-22. 100 points = free coffee.' } }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.rev).toBe(4)
    expect(body.config).toEqual({ ...DEFAULT_AGENT_CONFIG, mode: 'shadow', knowledge: 'Open 11-22. 100 points = free coffee.' })
    expect(body.adjusted).toEqual([])
    expect(vi.mocked(saveAgentSettingsAtRev).mock.calls[0].slice(0, 2)).toEqual([RID, 3])
  })

  it('AC-W2-API stale rev → 409 with the stored rev, nothing written', async () => {
    as('admin')
    const res = await PUT(req({ rev: 2, config: { mode: 'auto' } }))
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'stale', rev: 3 })
  })

  it('AC-W2-API out-of-range knobs are clamped by the resolver and reported in adjusted (not rejected, not silent)', async () => {
    as('admin')
    const res = await PUT(req({
      rev: 3,
      config: { temperature: 5, maxReplyChars: 99999, debounceMs: -10, maxToolCalls: 2.6, knowledge: 'k'.repeat(9000), disclosureText: '   ' },
    }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.config).toMatchObject({ temperature: 1, maxReplyChars: 1500, debounceMs: 0, maxToolCalls: 3, disclosureText: DEFAULT_DISCLOSURE_TEXT })
    expect(body.config.knowledge).toHaveLength(8000)
    expect([...body.adjusted].sort()).toEqual(['debounceMs', 'disclosureText', 'knowledge', 'maxReplyChars', 'maxToolCalls', 'temperature'])
  })

  it('AC-W2-API the fields are merged onto the stored config: unsent knobs keep their stored value', async () => {
    as('admin')
    storedAt(3, { ...DEFAULT_AGENT_CONFIG, mode: 'shadow', maxReplyChars: 400, instructions: 'Friendly' })
    const body = await (await PUT(req({ rev: 3, config: { mode: 'auto' } }))).json()
    expect(body.config).toMatchObject({ mode: 'auto', maxReplyChars: 400, instructions: 'Friendly' })
  })

  it('AC-W2-API an unknown mode is resolved to off and reported, unknown keys are ignored', async () => {
    as('admin')
    const body = await (await PUT(req({ rev: 3, config: { mode: 'yolo', restaurantId: 'other', rev: 99 } }))).json()
    expect(body.config.mode).toBe('off')
    expect(body.adjusted).toEqual(['mode'])
    expect(body.config).not.toHaveProperty('restaurantId')
  })

  it.each([
    ['not JSON', 'nope'],
    ['no rev', { config: { mode: 'auto' } }],
    ['a non-integer rev', { rev: '3', config: { mode: 'auto' } }],
    ['no config object', { rev: 3, config: ['auto'] }],
  ])('AC-W2-API %s → 400, nothing saved', async (_label, body) => {
    as('admin')
    expect((await PUT(req(body))).status).toBe(400)
    expect(saveAgentSettingsAtRev).not.toHaveBeenCalled()
  })
})
