import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../client', () => ({
  createServerSupabaseClient: vi.fn(),
}))

import { createServerSupabaseClient } from '../../client'
import {
  insertEvent,
  findLatest,
  isGreenForDays,
  qualityStateRepository,
} from '../quality-state-repository'
import { QualityStateEvent } from '@/domain/entities/quality-state-event'

interface InsertRecorder {
  table: string | null
  inserted: Record<string, unknown> | null
}

function buildInsertClient(opts: { error: { message: string } | null } = { error: null }): {
  client: ReturnType<typeof createServerSupabaseClient>
  recorder: InsertRecorder
} {
  const recorder: InsertRecorder = { table: null, inserted: null }
  const insert = vi.fn().mockImplementation((row: Record<string, unknown>) => {
    recorder.inserted = row
    return Promise.resolve({ error: opts.error })
  })
  const from = vi.fn().mockImplementation((t: string) => {
    recorder.table = t
    return { insert }
  })
  return {
    client: { from } as unknown as ReturnType<typeof createServerSupabaseClient>,
    recorder,
  }
}

interface SelectRecorder {
  table: string | null
  eqs: Array<{ col: string; val: unknown }>
  orders: Array<{ column: string; ascending: boolean }>
  limit: number | null
}

function buildSelectClient(
  result: { data: unknown; error: { message: string } | null }
): {
  client: ReturnType<typeof createServerSupabaseClient>
  recorder: SelectRecorder
} {
  const recorder: SelectRecorder = {
    table: null,
    eqs: [],
    orders: [],
    limit: null,
  }
  const maybeSingle = vi.fn().mockResolvedValue(result)
  const limit = vi.fn().mockImplementation((n: number) => {
    recorder.limit = n
    return { maybeSingle }
  })
  // The chain returned by `.eq()` must support both further `.eq(...)` calls
  // (for optional filters like phone_number_id) and `.order(...).order().limit()`.
  const eqChain: Record<string, unknown> = { limit }
  eqChain.eq = vi.fn().mockImplementation((col: string, val: unknown) => {
    recorder.eqs.push({ col, val })
    return eqChain
  })
  eqChain.order = vi.fn().mockImplementation(
    (column: string, opts: { ascending: boolean }) => {
      recorder.orders.push({ column, ascending: opts.ascending })
      return eqChain
    }
  )
  const select = vi.fn().mockReturnValue({
    eq: (col: string, val: unknown) => {
      recorder.eqs.push({ col, val })
      return eqChain
    },
  })
  const from = vi.fn().mockImplementation((t: string) => {
    recorder.table = t
    return { select }
  })
  return {
    client: { from } as unknown as ReturnType<typeof createServerSupabaseClient>,
    recorder,
  }
}

describe('insertEvent', () => {
  beforeEach(() => vi.clearAllMocks())

  it('inserts a row mapped from the entity', async () => {
    const { client, recorder } = buildInsertClient()
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    const event = QualityStateEvent.fromWebhook({
      id: 'evt-1',
      restaurantId: 'rest-1',
      phoneNumberId: 'pn-1',
      qualityRating: 'YELLOW',
      messagingTier: 'TIER_1K',
      flagged: false,
      rawPayload: { source: 'kapso' },
      transitionedAt: '2026-05-04T10:00:00.000Z',
    })

    await insertEvent(event)

    expect(recorder.table).toBe('tenant_quality_state')
    expect(recorder.inserted).toEqual({
      id: 'evt-1',
      restaurant_id: 'rest-1',
      phone_number_id: 'pn-1',
      display_phone_number: null,
      quality_rating: 'YELLOW',
      messaging_tier: 'TIER_1K',
      flagged: false,
      raw_payload: { source: 'kapso' },
      transitioned_at: '2026-05-04T10:00:00.000Z',
    })
  })

  it('throws contextually when the database returns an error', async () => {
    const { client } = buildInsertClient({
      error: { message: 'permission denied' },
    })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    const event = QualityStateEvent.fromWebhook({
      id: 'evt-1',
      restaurantId: 'rest-1',
      phoneNumberId: 'pn-1',
      qualityRating: 'GREEN',
    })

    await expect(insertEvent(event)).rejects.toThrow(
      'insertEvent: permission denied'
    )
  })
})

describe('findLatest', () => {
  beforeEach(() => vi.clearAllMocks())

  it('queries by restaurant_id, orders by transitioned_at DESC + created_at DESC, limits to 1', async () => {
    const { client, recorder } = buildSelectClient({
      data: {
        id: 'evt-1',
        restaurant_id: 'rest-1',
        phone_number_id: 'pn-1',
        display_phone_number: null,
        quality_rating: 'GREEN',
        messaging_tier: 'TIER_1K',
        flagged: false,
        raw_payload: null,
        transitioned_at: '2026-05-04T10:00:00.000Z',
      },
      error: null,
    })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    const result = await findLatest({ restaurantId: 'rest-1' })

    expect(recorder.table).toBe('tenant_quality_state')
    expect(recorder.eqs).toEqual([{ col: 'restaurant_id', val: 'rest-1' }])
    // Two-key sort: primary transitioned_at DESC, tiebreaker created_at DESC
    expect(recorder.orders).toEqual([
      { column: 'transitioned_at', ascending: false },
      { column: 'created_at', ascending: false },
    ])
    expect(recorder.limit).toBe(1)
    expect(result?.snapshot.qualityRating).toBe('GREEN')
    expect(result?.snapshot.id).toBe('evt-1')
  })

  it('also filters by phone_number_id when provided', async () => {
    const { client, recorder } = buildSelectClient({
      data: null,
      error: null,
    })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    await findLatest({ restaurantId: 'rest-1', phoneNumberId: 'pn-2' })

    expect(recorder.eqs).toEqual([
      { col: 'restaurant_id', val: 'rest-1' },
      { col: 'phone_number_id', val: 'pn-2' },
    ])
    expect(recorder.orders).toEqual([
      { column: 'transitioned_at', ascending: false },
      { column: 'created_at', ascending: false },
    ])
  })

  it('does NOT filter by phone_number_id when omitted (tenant-wide rollup)', async () => {
    const { client, recorder } = buildSelectClient({
      data: null,
      error: null,
    })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    await findLatest({ restaurantId: 'rest-1' })

    expect(recorder.eqs).toEqual([{ col: 'restaurant_id', val: 'rest-1' }])
  })

  it('returns null when no transitions exist for the tenant', async () => {
    const { client } = buildSelectClient({ data: null, error: null })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    const result = await findLatest({ restaurantId: 'rest-empty' })

    expect(result).toBeNull()
  })

  it('throws contextually on database error', async () => {
    const { client } = buildSelectClient({
      data: null,
      error: { message: 'connection_failure' },
    })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    await expect(findLatest({ restaurantId: 'rest-1' })).rejects.toThrow(
      'findLatest: connection_failure'
    )
  })
})

describe('isGreenForDays (WONB-008 RPC wrapper)', () => {
  interface RpcRecorder {
    name: string | null
    args: Record<string, unknown> | null
  }

  function buildRpcClient(result: { data: unknown; error: { message: string } | null }): {
    client: ReturnType<typeof createServerSupabaseClient>
    recorder: RpcRecorder
  } {
    const recorder: RpcRecorder = { name: null, args: null }
    const rpc = vi.fn().mockImplementation(
      (name: string, args: Record<string, unknown>) => {
        recorder.name = name
        recorder.args = args
        return Promise.resolve(result)
      }
    )
    return {
      client: { rpc } as unknown as ReturnType<typeof createServerSupabaseClient>,
      recorder,
    }
  }

  beforeEach(() => vi.clearAllMocks())

  it('calls tenant_green_for_days RPC with positional restaurant + minDays args', async () => {
    const { client, recorder } = buildRpcClient({ data: true, error: null })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    const allowed = await isGreenForDays('rest-1', 7)

    expect(allowed).toBe(true)
    expect(recorder.name).toBe('tenant_green_for_days')
    expect(recorder.args).toEqual({
      p_restaurant_id: 'rest-1',
      p_min_days: 7,
    })
  })

  it('returns false when the RPC returns false', async () => {
    const { client } = buildRpcClient({ data: false, error: null })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    const allowed = await isGreenForDays('rest-1', 7)
    expect(allowed).toBe(false)
  })

  it('returns false when the RPC yields null (no quality signal yet)', async () => {
    const { client } = buildRpcClient({ data: null, error: null })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    const allowed = await isGreenForDays('rest-empty', 7)
    expect(allowed).toBe(false)
  })

  it('throws contextually on RPC error', async () => {
    const { client } = buildRpcClient({
      data: null,
      error: { message: 'function does not exist' },
    })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    await expect(isGreenForDays('rest-1', 7)).rejects.toThrow(
      /isGreenForDays.*function does not exist/
    )
  })
})

describe('qualityStateRepository contract lock', () => {
  it('exposes insertEvent, findLatest, and isGreenForDays from the same module', () => {
    expect(qualityStateRepository.insertEvent).toBe(insertEvent)
    expect(qualityStateRepository.findLatest).toBe(findLatest)
    expect(qualityStateRepository.isGreenForDays).toBe(isGreenForDays)
  })
})
