import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../../client', () => ({
  createServerSupabaseClient: vi.fn(),
}))

import { createServerSupabaseClient } from '../../client'
import {
  throttleMemberPmm,
  markMemberUnreachable,
} from '../member-quality-state'

interface QueryRecorder {
  table: string | null
  update: Record<string, unknown> | null
  eqCalls: Array<[string, unknown]>
  orCalls: string[]
}

function buildSupabase(returnedError: { message: string } | null = null): {
  client: ReturnType<typeof createServerSupabaseClient>
  recorder: QueryRecorder
} {
  const recorder: QueryRecorder = {
    table: null,
    update: null,
    eqCalls: [],
    orCalls: [],
  }
  const resolved = { error: returnedError }
  // The chain shapes:
  //   throttle:    .from('members').update(...).eq('id', X).or(...)            -> resolved
  //   unreachable: .from('members').update(...).eq('id', X)                    -> resolved
  // We synthesise a thenable on every call so tests don't care which is the
  // terminal step.
  function chainable(): unknown {
    const c: Record<string, unknown> = {}
    c.eq = vi.fn().mockImplementation((col: string, val: unknown) => {
      recorder.eqCalls.push([col, val])
      return c
    })
    c.or = vi.fn().mockImplementation((expr: string) => {
      recorder.orCalls.push(expr)
      return c
    })
    c.then = (
      onFulfilled: (v: typeof resolved) => unknown,
      onRejected?: (e: unknown) => unknown
    ) => Promise.resolve(resolved).then(onFulfilled, onRejected)
    return c
  }
  const update = vi.fn().mockImplementation((u: Record<string, unknown>) => {
    recorder.update = u
    return chainable()
  })
  const from = vi.fn().mockImplementation((t: string) => {
    recorder.table = t
    return { update }
  })
  return {
    client: { from } as unknown as ReturnType<typeof createServerSupabaseClient>,
    recorder,
  }
}

const FIXED_NOW = new Date('2026-05-04T10:00:00.000Z')

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  vi.setSystemTime(FIXED_NOW)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('throttleMemberPmm', () => {
  it('updates members.pmm_throttled_until to now() + cooldownHours, scoped by (id, restaurant_id)', async () => {
    const { client, recorder } = buildSupabase()
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    await throttleMemberPmm('mem-1', 'rest-1', 24)

    expect(recorder.table).toBe('members')
    expect(recorder.update).not.toBeNull()
    const until = (recorder.update as Record<string, string>).pmm_throttled_until
    expect(until).toBe(
      new Date(FIXED_NOW.getTime() + 24 * 3600_000).toISOString()
    )
    expect(recorder.eqCalls).toContainEqual(['id', 'mem-1'])
    expect(recorder.eqCalls).toContainEqual(['restaurant_id', 'rest-1'])
  })

  it('guards against regression: only updates when current value is NULL or earlier than the new cooldown', async () => {
    // The repository SHOULD include a WHERE clause
    //   pmm_throttled_until IS NULL OR pmm_throttled_until < $newValue
    // so that re-throttling does not shorten an already-longer cooldown.
    // We assert the guard appears on the query in any reasonable form
    // (either via `.or(...)` PostgREST filter, or chained `.is`/`.lt`).
    const { client, recorder } = buildSupabase()
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    await throttleMemberPmm('mem-1', 'rest-1', 24)

    const newUntil = new Date(
      FIXED_NOW.getTime() + 24 * 3600_000
    ).toISOString()
    // PostgREST style: pmm_throttled_until.is.null,pmm_throttled_until.lt.<newUntil>
    const orExpr = recorder.orCalls.join(' ')
    expect(orExpr).toContain('pmm_throttled_until.is.null')
    expect(orExpr).toContain(`pmm_throttled_until.lt.${newUntil}`)
  })

  it('throws when supabase returns an error', async () => {
    const { client } = buildSupabase({ message: 'db down' })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    await expect(throttleMemberPmm('mem-1', 'rest-1', 24)).rejects.toThrow(
      'db down'
    )
  })

  it('cross-tenant isolation: same member id in two restaurants — throttling for restaurant A only mutates A row', async () => {
    // Model: an in-memory `members` table with two rows sharing the same id
    // but different restaurant_ids. Walk the .eq() filters from the call to
    // assert the UPDATE matches exactly one row (the rest-A row).
    const rows = [
      {
        id: 'mem-shared',
        restaurant_id: 'rest-A',
        pmm_throttled_until: null as string | null,
      },
      {
        id: 'mem-shared',
        restaurant_id: 'rest-B',
        pmm_throttled_until: null as string | null,
      },
    ]
    type Filter = { col: string; val: unknown }
    const filters: Filter[] = []
    let updatePayload: Record<string, unknown> | null = null
    function chain(): unknown {
      const c: Record<string, unknown> = {}
      c.eq = vi.fn().mockImplementation((col: string, val: unknown) => {
        filters.push({ col, val })
        return c
      })
      c.or = vi.fn().mockImplementation(() => c)
      c.then = (
        onFulfilled: (v: { error: null }) => unknown,
        onRejected?: (e: unknown) => unknown
      ) => {
        // Simulate the UPDATE: mutate every row matching all `.eq()` filters.
        for (const r of rows) {
          const match = filters.every(
            (f) => (r as Record<string, unknown>)[f.col] === f.val
          )
          if (match && updatePayload) Object.assign(r, updatePayload)
        }
        return Promise.resolve({ error: null }).then(onFulfilled, onRejected)
      }
      return c
    }
    const update = vi.fn().mockImplementation((u: Record<string, unknown>) => {
      updatePayload = u
      return chain()
    })
    const from = vi.fn().mockReturnValue({ update })
    vi.mocked(createServerSupabaseClient).mockReturnValue({
      from,
    } as unknown as ReturnType<typeof createServerSupabaseClient>)

    await throttleMemberPmm('mem-shared', 'rest-A', 24)

    const rowA = rows.find((r) => r.restaurant_id === 'rest-A')!
    const rowB = rows.find((r) => r.restaurant_id === 'rest-B')!
    expect(rowA.pmm_throttled_until).not.toBeNull()
    expect(rowB.pmm_throttled_until).toBeNull()
  })
})

describe('markMemberUnreachable', () => {
  it('sets unreachable_at to now() for the given member, scoped by (id, restaurant_id)', async () => {
    const { client, recorder } = buildSupabase()
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    await markMemberUnreachable('mem-1', 'rest-1')

    expect(recorder.table).toBe('members')
    expect(recorder.update).toEqual({ unreachable_at: FIXED_NOW.toISOString() })
    expect(recorder.eqCalls).toContainEqual(['id', 'mem-1'])
    expect(recorder.eqCalls).toContainEqual(['restaurant_id', 'rest-1'])
  })

  it('is idempotent: a second call rewrites the same column without throwing', async () => {
    const { client } = buildSupabase()
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    await markMemberUnreachable('mem-1', 'rest-1')
    await expect(
      markMemberUnreachable('mem-1', 'rest-1')
    ).resolves.toBeUndefined()
  })

  it('throws when supabase returns an error', async () => {
    const { client } = buildSupabase({ message: 'db down' })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    await expect(markMemberUnreachable('mem-1', 'rest-1')).rejects.toThrow(
      'db down'
    )
  })
})
