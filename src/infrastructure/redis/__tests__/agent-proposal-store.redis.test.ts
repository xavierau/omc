// AGENT-003 R15 + review F1: the Redis proposal store against a real Redis (the Lua take-if-earlier, owner/confirmable, the TTL).
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
    await store.save(KEY, proposal('2026-11-19T10:01:00.123456+00:00'), 60_000, 'run-1')
    expect(await store.markConfirmable(KEY, 'run-1')).toBe(true)
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
    await store.save(KEY, proposal('2026-11-19T10:01:00.000Z'), 50, 'run-1')
    await store.markConfirmable(KEY, 'run-1')
    expect(await client.pttl(proposalKey(KEY))).toBeGreaterThan(0)
    await new Promise((r) => setTimeout(r, 120))
    expect(await store.takeIfEarlier(KEY, '2026-11-19T10:02:00.000Z', 'create')).toEqual({ kind: 'none' })
  })

  it('AC-F1 a proposal is invisible until its owner marks it confirmable; discard and mark are owner-checked', async () => {
    const store = createRedisProposalStore(client)
    await store.save(KEY, proposal('2026-11-19T10:01:00.000Z'), 60_000, 'run-1')
    // Not confirmable: no WAITING line, a later job's take finds nothing; the same job still gets not_earlier (R15).
    expect(await store.peekKind(KEY)).toBeNull()
    expect(await store.takeIfEarlier(KEY, '2026-11-19T10:02:00.000Z', 'create')).toEqual({ kind: 'none' })
    expect(await store.takeIfEarlier(KEY, '2026-11-19T10:01:00.000Z', 'create')).toEqual({ kind: 'not_earlier' })
    // Another run can neither confirm nor discard it.
    expect(await store.markConfirmable(KEY, 'run-2')).toBe(false)
    await store.discard(KEY, 'run-2')
    expect(await client.exists(proposalKey(KEY))).toBe(1)
    // Its owner discards it (a run whose read-back never reached the diner).
    await store.discard(KEY, 'run-1')
    expect(await client.exists(proposalKey(KEY))).toBe(0)
    expect(await store.markConfirmable(KEY, 'run-1')).toBe(false)
    // A newer run's proposal replaces the old owner: the old run's discard leaves it.
    await store.save(KEY, proposal('2026-11-19T10:01:00.000Z'), 60_000, 'run-1')
    await store.save(KEY, proposal('2026-11-19T10:01:30.000Z'), 60_000, 'run-3')
    await store.discard(KEY, 'run-1')
    expect(await store.markConfirmable(KEY, 'run-3')).toBe(true)
    expect(await store.peekKind(KEY)).toBe('create')
    expect(await store.takeIfEarlier(KEY, '2026-11-19T10:02:00.000Z', 'create')).toMatchObject({ kind: 'taken' })
  })
})
