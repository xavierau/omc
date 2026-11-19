// AGENT-001 W1: query shape of the agent repositories (AC-R2, AC-R5).
// Column existence is proven against the SQL by agent-schema-contract.test.ts.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { recordingSupabase, filtersOf } from '@/test-utils/recording-supabase'

vi.mock('@/infrastructure/supabase/client', () => ({ createServerSupabaseClient: vi.fn() }))
vi.mock('../reward-repository', () => ({ listActiveRewards: vi.fn() }))
vi.mock('../restaurant-repository', () => ({ getRestaurantRedirect: vi.fn(), getContactConfig: vi.fn() }))

import { createServerSupabaseClient } from '@/infrastructure/supabase/client'
import {
  countModelCalls,
  hasRateLimitedSince,
  history,
  insertUserMessage,
  isSilenced,
  latestUserMessageId,
  purgeExpiredSilences,
  purgeOlderThan,
  recordModelRow,
  silenceUntil,
} from '../agent-message-repository'
import { getAgentMemberSummary, getAgentContactAction, listAgentRewards } from '../agent-tool-repository'
import { changeAgentConfig, getAgentConfig, listAgentTenantConfigs } from '../agent-config-repository'
import { listActiveRewards } from '../reward-repository'
import { getContactConfig, getRestaurantRedirect } from '../restaurant-repository'
import { DEFAULT_AGENT_CONFIG } from '@/domain/value-objects/agent-config'

const KEY = { restaurantId: 'rest-a', phone: '+85291234567' }

function use(results: Parameters<typeof recordingSupabase>[0]) {
  const rec = recordingSupabase(results)
  vi.mocked(createServerSupabaseClient).mockReturnValue(rec.client as never)
  return rec
}

beforeEach(() => vi.clearAllMocks())

describe('AC-R2 tool queries are scoped by the job restaurant AND phone in SQL', () => {
  it('AC-R2 member summary: WHERE restaurant_id = job restaurant AND phone = job phone; stamp cards by restaurant + that member', async () => {
    const rec = use([
      { data: { id: 'm-1', points_balance: 120 } },
      { data: [{ stamps_count: 3, stamps_required: 8, stamp_campaigns: { name: 'Coffee', name_zh: '咖啡' } }] },
    ])
    const summary = await getAgentMemberSummary(KEY)
    expect(rec.queries[0].table).toBe('members')
    expect(filtersOf(rec.queries[0])).toEqual(['eq:restaurant_id=rest-a', 'eq:phone=+85291234567'])
    expect(rec.queries[1].table).toBe('member_stamp_cards')
    expect(filtersOf(rec.queries[1])).toEqual(['eq:restaurant_id=rest-a', 'eq:member_id=m-1', 'eq:status=in_progress'])
    expect(summary).toEqual({ member: true, pointsBalance: 120, stampCards: [{ campaign: '咖啡', stamps: 3, stampsRequired: 8 }] })
    // Only loyalty numbers: no member id or name reaches the model.
    expect(JSON.stringify(summary)).not.toContain('m-1')
  })

  it('AC-R2 not a member → { member: false } and no card query', async () => {
    const rec = use([{ data: null }])
    expect(await getAgentMemberSummary(KEY)).toEqual({ member: false })
    expect(rec.queries).toHaveLength(1)
  })

  it('AC-R2 rewards and contact action are read for the job restaurant only', async () => {
    vi.mocked(listActiveRewards).mockResolvedValue([
      { id: 'r1', restaurantId: 'rest-a', name: 'Free coffee', pointsCost: 100, discountType: 'fixed_amount', discountValue: 30, couponExpiryDays: 30, isActive: true, sortOrder: 0 },
      { id: 'r2', restaurantId: 'rest-a', name: '10% off', pointsCost: 200, discountType: 'percentage', discountValue: 10, couponExpiryDays: 30, isActive: true, sortOrder: 1 },
    ])
    vi.mocked(getRestaurantRedirect).mockResolvedValue({ redirectNumber: '+85290000000', redirectLabel: 'Chat with us' })
    vi.mocked(getContactConfig).mockResolvedValue({ ackText: 'Thanks!' } as never)
    expect(await listAgentRewards('rest-a')).toEqual([
      { name: 'Free coffee', pointsCost: 100, discount: 'HK$30 off' },
      { name: '10% off', pointsCost: 200, discount: '10% off' },
    ])
    expect(listActiveRewards).toHaveBeenCalledWith('rest-a')
    expect(await getAgentContactAction('rest-a')).toEqual({ url: 'https://wa.me/85290000000', label: 'Chat with us', text: 'Thanks!' })
    expect(getRestaurantRedirect).toHaveBeenCalledWith('rest-a')
  })
})

describe('AC-R5 history and purge queries', () => {
  it('AC-R5 history: one conversation, inside the TTL, user rows + sent/draft replies, newest N, returned oldest first', async () => {
    const rec = use([
      {
        data: [
          { role: 'user', text: 'u2', created_at: '2026-11-19T09:20:00Z' },
          { role: 'model', text: 'm1', created_at: '2026-11-19T09:11:00Z' },
          { role: 'user', text: 'u1', created_at: '2026-11-19T09:10:00Z' },
        ],
      },
    ])
    const rows = await history(KEY, 3, '2026-11-19T09:00:00.000Z')
    const q = rec.queries[0]
    expect(q.table).toBe('agent_messages')
    expect(filtersOf(q)).toEqual(['eq:restaurant_id=rest-a', 'eq:phone=+85291234567', 'or:role.eq.user,outcome.in.(sent,shadow_draft)'])
    expect(q.calls).toContainEqual(['gte', 'created_at', '2026-11-19T09:00:00.000Z'])
    expect(q.calls).toContainEqual(['order', 'created_at', { ascending: false }])
    expect(q.calls).toContainEqual(['limit', 3])
    expect(rows.map((r) => r.text)).toEqual(['u1', 'm1', 'u2'])
  })

  it('AC-R5 purge deletes only the tenant’s rows older than the cutoff', async () => {
    const rec = use([{ count: 4 }])
    expect(await purgeOlderThan('rest-a', '2026-11-16T10:00:00.000Z')).toBe(4)
    const q = rec.queries[0]
    expect(q.calls[0]).toEqual(['delete', { count: 'exact' }])
    expect(filtersOf(q)).toEqual(['eq:restaurant_id=rest-a', 'lt:created_at=2026-11-16T10:00:00.000Z'])
  })

  it('AC-R5 expired silences are purged by time', async () => {
    const rec = use([{ count: 2 }])
    expect(await purgeExpiredSilences('2026-11-19T10:00:00.000Z')).toBe(2)
    expect(rec.queries[0].table).toBe('agent_silences')
    expect(filtersOf(rec.queries[0])).toEqual(['lt:silenced_until=2026-11-19T10:00:00.000Z'])
  })
})

describe('agent_messages writes and counters', () => {
  it('insertUserMessage writes a user row and maps 23505 to duplicate', async () => {
    const rec = use([{ data: { id: 'row-1' } }, { error: { message: 'dup', code: '23505' } as never }])
    expect(await insertUserMessage({ ...KEY, wamid: 'w1', text: 'hi' })).toEqual({ kind: 'inserted', id: 'row-1' })
    expect(rec.queries[0].calls[0]).toEqual(['insert', { restaurant_id: 'rest-a', phone: '+85291234567', role: 'user', text: 'hi', wamid: 'w1' }])
    expect(await insertUserMessage({ ...KEY, wamid: 'w1', text: 'hi' })).toEqual({ kind: 'duplicate' })
  })

  it('insertUserMessage throws other errors without echoing the row', async () => {
    use([{ error: { message: 'value "hi" too long', code: '22001' } as never }])
    await expect(insertUserMessage({ ...KEY, wamid: 'w1', text: 'hi' })).rejects.toThrow('insertUserMessage: 22001')
  })

  it('recordModelRow writes the outcome row with tool names only', async () => {
    const rec = use([{}])
    await recordModelRow({ ...KEY, outcome: 'sent', text: 'ok', model: 'gemini-3.8-flash', latencyMs: 812, toolCalls: ['list_rewards'] })
    expect(rec.queries[0].calls[0]).toEqual([
      'insert',
      { restaurant_id: 'rest-a', phone: '+85291234567', role: 'model', text: 'ok', outcome: 'sent', model: 'gemini-3.8-flash', latency_ms: 812, tool_calls: ['list_rewards'] },
    ])
  })

  it('latestUserMessageId reads the newest user row of the conversation', async () => {
    const rec = use([{ data: { id: 'row-9' } }])
    expect(await latestUserMessageId(KEY)).toBe('row-9')
    expect(filtersOf(rec.queries[0])).toEqual(['eq:restaurant_id=rest-a', 'eq:phone=+85291234567', 'eq:role=user'])
  })

  it('countModelCalls counts model-call outcomes per phone, or per tenant when phone is null', async () => {
    const rec = use([{ count: 3 }, { count: 40 }])
    expect(await countModelCalls('rest-a', '+85291234567', '2026-11-19T09:00:00.000Z')).toBe(3)
    expect(await countModelCalls('rest-a', null, '2026-11-18T10:00:00.000Z')).toBe(40)
    expect(filtersOf(rec.queries[0])).toEqual([
      'eq:restaurant_id=rest-a',
      'eq:phone=+85291234567',
      'in:outcome=shadow_draft,sent,fallback,error',
    ])
    expect(filtersOf(rec.queries[1])).toEqual(['eq:restaurant_id=rest-a', 'in:outcome=shadow_draft,sent,fallback,error'])
  })

  it('hasRateLimitedSince is scoped to the conversation', async () => {
    const rec = use([{ count: 1 }])
    expect(await hasRateLimitedSince(KEY, '2026-11-19T09:00:00.000Z')).toBe(true)
    expect(filtersOf(rec.queries[0])).toEqual(['eq:restaurant_id=rest-a', 'eq:phone=+85291234567', 'eq:outcome=rate_limited'])
  })

  it('isSilenced reads the conversation’s silence still in force', async () => {
    const rec = use([{ data: { silenced_until: 'x' } }])
    expect(await isSilenced(KEY, '2026-11-19T10:00:00.000Z')).toBe(true)
    expect(filtersOf(rec.queries[0])).toEqual(['eq:restaurant_id=rest-a', 'eq:phone=+85291234567', 'gt:silenced_until=2026-11-19T10:00:00.000Z'])
  })

  it('silenceUntil upserts on (restaurant_id, phone)', async () => {
    const upsert = vi.fn(async () => ({ error: null }))
    vi.mocked(createServerSupabaseClient).mockReturnValue({ from: vi.fn(() => ({ upsert })) } as never)
    await silenceUntil(KEY, '2026-11-19T22:00:00.000Z')
    expect(upsert).toHaveBeenCalledWith(
      { restaurant_id: 'rest-a', phone: '+85291234567', silenced_until: '2026-11-19T22:00:00.000Z' },
      { onConflict: 'restaurant_id,phone' }
    )
  })
})

describe('agent config repository', () => {
  it('getAgentConfig resolves the stored blob and degrades to defaults on error', async () => {
    use([{ data: { agent_config: { mode: 'shadow' } } }])
    expect((await getAgentConfig('rest-a')).mode).toBe('shadow')
    use([{ error: { message: 'boom' } }])
    expect(await getAgentConfig('rest-a')).toEqual(DEFAULT_AGENT_CONFIG)
  })

  it('listAgentTenantConfigs resolves every tenant', async () => {
    use([{ data: [{ id: 'a', agent_config: { historyTtlHours: 24 } }, { id: 'b', agent_config: null }] }])
    const list = await listAgentTenantConfigs()
    expect(list.map((t) => [t.restaurantId, t.config.historyTtlHours])).toEqual([['a', 24], ['b', 72]])
  })

  it('changeAgentConfig is a CAS on agent_config.rev', async () => {
    const rec = use([{ data: { agent_config: { mode: 'off', rev: 2 } } }, { data: [{ id: 'rest-a' }] }])
    const next = await changeAgentConfig('rest-a', (c) => ({ ...c, mode: 'shadow' }))
    expect(next?.mode).toBe('shadow')
    const update = rec.queries[1]
    expect(update.calls[0]).toEqual(['update', { agent_config: expect.objectContaining({ mode: 'shadow', rev: 3 }) }])
    expect(filtersOf(update)).toEqual(['eq:id=rest-a', 'eq:agent_config->>rev=2'])
  })
})
