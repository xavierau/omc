// AGENT-001 W2 AC-R7: the conversation log routes are admin only, scoped by
// restaurant_id in SQL, and never return a full phone. The real repository
// runs over a recording Supabase client, so the WHERE clause is asserted.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { recordingSupabase, filtersOf, type RecordedQuery } from '@/test-utils/recording-supabase'

vi.mock('@/infrastructure/supabase/guards/tenant-guard')
vi.mock('@/infrastructure/supabase/client', () => ({ createServerSupabaseClient: vi.fn() }))

import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { createServerSupabaseClient } from '@/infrastructure/supabase/client'
import { GET as listThreads } from '../conversations/route'
import { GET as getThread } from '../conversations/[threadKey]/route'

const TENANT_A = 'rest-a'
const PHONE = '+85291234567'
const KEY_A = '11111111-1111-4111-8111-111111111111'
const KEY_B = '22222222-2222-4222-8222-222222222222'

function as(role: string, restaurantId = TENANT_A) {
  vi.mocked(getTenantContext).mockResolvedValue({ userId: 'u-1', restaurantId, role, tenantStatus: 'active' })
}

/** Rows exist only for tenant A; a lookup outside it finds nothing, as the WHERE would. */
function db() {
  const rec = recordingSupabase((query: RecordedQuery) => {
    const f = filtersOf(query)
    if (!f.includes(`eq:restaurant_id=${TENANT_A}`)) return { data: query.calls.some(([m]) => m === 'maybeSingle') ? null : [] }
    if (query.calls.some(([m]) => m === 'maybeSingle')) return { data: f.includes(`eq:id=${KEY_A}`) ? { phone: PHONE } : null }
    if (f.includes(`eq:phone=${PHONE}`)) {
      return {
        data: [
          { id: 'm2', role: 'model', text: '你有 120 分。\n\n🤖 自動回覆 Automated reply', outcome: 'sent', model: 'gemini-3.1-flash-lite', latency_ms: 2100, tool_calls: ['get_member_summary'], created_at: '2026-11-19T10:00:05Z' },
          { id: 'm1', role: 'user', text: '我有幾多分?', outcome: null, model: null, latency_ms: null, tool_calls: [], created_at: '2026-11-19T10:00:00Z' },
        ],
      }
    }
    return {
      data: [
        { id: KEY_A, phone: PHONE, role: 'model', outcome: 'shadow_draft', created_at: '2026-11-19T10:00:05Z' },
        { id: 'x1', phone: PHONE, role: 'user', outcome: null, created_at: '2026-11-19T10:00:00Z' },
        { id: 'x2', phone: '+85298887777', role: 'user', outcome: null, created_at: '2026-11-19T09:00:00Z' },
      ],
    }
  })
  vi.mocked(createServerSupabaseClient).mockReturnValue(rec.client as never)
  return rec
}

const threadReq = (key: string) => new NextRequest(`http://localhost/api/dashboard/agent/conversations/${key}`)
const params = (threadKey: string) => ({ params: Promise.resolve({ threadKey }) })

beforeEach(() => vi.clearAllMocks())

describe('AC-R7 GET /api/dashboard/agent/conversations', () => {
  it('AC-R7 non-admin → 403 and no query runs', async () => {
    as('staff')
    const rec = db()
    expect((await listThreads()).status).toBe(403)
    expect(rec.queries).toHaveLength(0)
  })

  it('AC-R7 admin: query scoped by restaurant_id in the WHERE; threads masked to the last 4 digits', async () => {
    as('admin')
    const rec = db()
    const res = await listThreads()
    expect(res.status).toBe(200)
    expect(rec.queries[0].table).toBe('agent_messages')
    expect(filtersOf(rec.queries[0])).toContain(`eq:restaurant_id=${TENANT_A}`)
    const body = await res.json()
    expect(body.threads).toEqual([
      { key: KEY_A, maskedPhone: '•••• 4567', lastActivityAt: '2026-11-19T10:00:05Z', messageCount: 2, latestOutcome: 'shadow_draft', needsStaff: false },
      { key: 'x2', maskedPhone: '•••• 7777', lastActivityAt: '2026-11-19T09:00:00Z', messageCount: 1, latestOutcome: null, needsStaff: false },
    ])
    const raw = JSON.stringify(body)
    expect(raw).not.toContain('91234567')
    expect(raw).not.toContain('98887777')
  })

  it('AC-R7 the list selects no message text', async () => {
    as('admin')
    const rec = db()
    await listThreads()
    expect(String(rec.queries[0].calls.find(([m]) => m === 'select')?.[1])).not.toContain('text')
  })
})

describe('AC-R7 GET /api/dashboard/agent/conversations/[threadKey]', () => {
  it('AC-R7 non-admin → 403 and no query runs', async () => {
    as('staff')
    const rec = db()
    expect((await getThread(threadReq(KEY_A), params(KEY_A))).status).toBe(403)
    expect(rec.queries).toHaveLength(0)
  })

  it("AC-R7 admin of tenant B with tenant A's thread key → 404; the lookup had restaurant_id = B in the WHERE", async () => {
    as('admin', 'rest-b')
    const rec = db()
    const res = await getThread(threadReq(KEY_A), params(KEY_A))
    expect(res.status).toBe(404)
    expect(filtersOf(rec.queries[0])).toEqual([`eq:id=${KEY_A}`, 'eq:restaurant_id=rest-b'])
    expect(rec.queries).toHaveLength(1)
    expect(JSON.stringify(await res.json())).not.toContain('4567')
  })

  it('AC-R7 unknown key in the own tenant → 404; a non-UUID key → 404 without a query', async () => {
    as('admin')
    const rec = db()
    expect((await getThread(threadReq(KEY_B), params(KEY_B))).status).toBe(404)
    expect((await getThread(threadReq('+85291234567'), params('+85291234567'))).status).toBe(404)
    expect(rec.queries).toHaveLength(1)
  })

  it('AC-R7 admin of the owning tenant: messages read by restaurant + phone in SQL; response has the masked phone only', async () => {
    as('admin')
    const rec = db()
    const res = await getThread(threadReq(KEY_A), params(KEY_A))
    expect(res.status).toBe(200)
    expect(filtersOf(rec.queries[1])).toEqual([`eq:restaurant_id=${TENANT_A}`, `eq:phone=${PHONE}`])
    const body = await res.json()
    expect(body.thread).toEqual({ key: KEY_A, maskedPhone: '•••• 4567' })
    expect(body.messages.map((m: { id: string }) => m.id)).toEqual(['m1', 'm2'])
    expect(body.messages[1]).toMatchObject({ outcome: 'sent', model: 'gemini-3.1-flash-lite', latencyMs: 2100, toolCalls: ['get_member_summary'] })
    expect(JSON.stringify(body)).not.toContain('91234567')
  })
})
