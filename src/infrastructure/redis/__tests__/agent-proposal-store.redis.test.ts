// AGENT-003 R15: the Redis proposal store against a real Redis (the Lua take-if-earlier and the TTL).
// Runs only with RUN_REDIS_TESTS=1 and REDIS_TEST_URL (a throwaway Redis; the test flushes nothing but its own keys).
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Redis } from 'ioredis'
import { createRedisProposalStore, proposalKey } from '../agent-proposal-store'
import { parseRedisUrl } from '../connection'
import type { AgentBookingProposal } from '@/domain/ports/agent-booking-proposal'

const RUN = process.env.RUN_REDIS_TESTS === '1' && !!process.env.REDIS_TEST_URL
const d = RUN ? describe : describe.skip

const KEY = { restaurantId: `rest-${Date.now()}`, phone: '+85291234567' }
const proposal = (inboundCreatedAt: string): AgentBookingProposal => ({
  kind: 'create',
  booking: { date: '2026-11-20', time: '19:00', partySize: 4, name: '陳生', notes: null },
  inboundCreatedAt,
  proposedAt: '2026-11-19T10:00:00.000Z',
})

d('AC-R15 AC-R22 Redis proposal store', () => {
  let client: Redis
  beforeAll(() => {
    client = new Redis(parseRedisUrl(process.env.REDIS_TEST_URL as string))
  })
  afterAll(async () => {
    await client.del(proposalKey(KEY))
    client.disconnect()
  })

  it('AC-R15 AC-R22 none → not_earlier / other kind for the same or an older job (kept) → taken once by a newer job', async () => {
    const store = createRedisProposalStore(client)
    expect(await store.takeIfEarlier(KEY, '2026-11-19T10:01:00.000Z', 'create')).toEqual({ kind: 'none' })
    expect(await store.peekKind(KEY)).toBeNull()
    await store.save(KEY, proposal('2026-11-19T10:01:00.123456+00:00'), 60_000)
    expect(await store.peekKind(KEY)).toBe('create')
    expect(await store.takeIfEarlier(KEY, '2026-11-19T10:01:00.123456+00:00', 'create')).toEqual({ kind: 'not_earlier' })
    expect(await store.takeIfEarlier(KEY, '2026-11-19T10:05:00.000Z', 'cancel')).toEqual({ kind: 'other_kind' })
    expect(await store.takeIfEarlier(KEY, '2026-11-19T10:00:00.000Z', 'create')).toEqual({ kind: 'not_earlier' })
    const [a, b] = await Promise.all([
      store.takeIfEarlier(KEY, '2026-11-19T10:02:00.000Z', 'create'),
      store.takeIfEarlier(KEY, '2026-11-19T10:02:00.000Z', 'create'),
    ])
    expect([a.kind, b.kind].sort()).toEqual(['none', 'taken'])
    expect(await store.peekKind(KEY)).toBeNull()
    expect(a.kind === 'taken' ? a.proposal : b.kind === 'taken' ? b.proposal : null).toEqual(proposal('2026-11-19T10:01:00.123456+00:00'))
  })

  it('AC-R15 the proposal expires with its TTL', async () => {
    const store = createRedisProposalStore(client)
    await store.save(KEY, proposal('2026-11-19T10:01:00.000Z'), 50)
    expect(await client.pttl(proposalKey(KEY))).toBeGreaterThan(0)
    await new Promise((r) => setTimeout(r, 120))
    expect(await store.takeIfEarlier(KEY, '2026-11-19T10:02:00.000Z', 'create')).toEqual({ kind: 'none' })
  })
})
