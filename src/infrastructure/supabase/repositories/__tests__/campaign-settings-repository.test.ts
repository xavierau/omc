import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../client', () => ({
  createServerSupabaseClient: vi.fn(),
}))

import { createServerSupabaseClient } from '../../client'
import {
  getMonthlyTenantSends,
  getReconfirmationDailyCap,
  setReconfirmationDailyCap,
  getReconfirmationSendsToday,
} from '../campaign-settings-repository'

type Row = {
  chargeable_sent_count: number | null
  non_chargeable_sent_count: number | null
}

function buildMockClient(rows: Row[] | null, error: { message: string } | null = null) {
  const gte = vi.fn().mockResolvedValue({ data: rows, error })
  const eq = vi.fn().mockReturnValue({ gte })
  const select = vi.fn().mockReturnValue({ eq })
  const from = vi.fn().mockReturnValue({ select })
  return { from, select }
}

describe('getMonthlyTenantSends', () => {
  beforeEach(() => vi.clearAllMocks())

  it('selects BOTH chargeable_sent_count and non_chargeable_sent_count', async () => {
    const client = buildMockClient([])
    vi.mocked(createServerSupabaseClient).mockReturnValue({ from: client.from } as never)

    await getMonthlyTenantSends('r-1')

    expect(client.select).toHaveBeenCalledWith('chargeable_sent_count, non_chargeable_sent_count')
  })

  it('sums chargeable + non-chargeable counts across all rows', async () => {
    const client = buildMockClient([
      { chargeable_sent_count: 100, non_chargeable_sent_count: 20 },
      { chargeable_sent_count: 50, non_chargeable_sent_count: 5 },
    ])
    vi.mocked(createServerSupabaseClient).mockReturnValue({ from: client.from } as never)

    const total = await getMonthlyTenantSends('r-1')

    expect(total).toBe(175)
  })

  it('counts non-chargeable sends toward the monthly guardrail total', async () => {
    // A welcome (non-chargeable) campaign that sent to 500 members must still
    // count against the monthly cap — otherwise tenants could bypass the limit.
    const client = buildMockClient([
      { chargeable_sent_count: 0, non_chargeable_sent_count: 500 },
    ])
    vi.mocked(createServerSupabaseClient).mockReturnValue({ from: client.from } as never)

    const total = await getMonthlyTenantSends('r-1')

    expect(total).toBe(500)
  })

  it('treats null counter columns as 0', async () => {
    const client = buildMockClient([
      { chargeable_sent_count: null, non_chargeable_sent_count: null },
      { chargeable_sent_count: 7, non_chargeable_sent_count: null },
    ])
    vi.mocked(createServerSupabaseClient).mockReturnValue({ from: client.from } as never)

    const total = await getMonthlyTenantSends('r-1')

    expect(total).toBe(7)
  })

  it('returns 0 when no rows', async () => {
    const client = buildMockClient([])
    vi.mocked(createServerSupabaseClient).mockReturnValue({ from: client.from } as never)

    expect(await getMonthlyTenantSends('r-1')).toBe(0)
  })

  it('throws when the query errors', async () => {
    const client = buildMockClient(null, { message: 'db down' })
    vi.mocked(createServerSupabaseClient).mockReturnValue({ from: client.from } as never)

    await expect(getMonthlyTenantSends('r-1')).rejects.toThrow('getMonthlyTenantSends: db down')
  })
})

describe('getReconfirmationDailyCap (WONB-008)', () => {
  interface ReadRecorder {
    table: string | null
    selected?: string
    eqs: Array<{ col: string; val: unknown }>
  }

  function buildReadClient(result: {
    data: { reconfirmation_daily_cap: number | null } | null
    error: { message: string; code?: string } | null
  }): {
    client: ReturnType<typeof createServerSupabaseClient>
    recorder: ReadRecorder
  } {
    const recorder: ReadRecorder = { table: null, eqs: [] }
    const maybeSingle = vi.fn().mockResolvedValue(result)
    const eqChain = {
      eq: vi.fn(),
      maybeSingle,
    } as unknown as { eq: ReturnType<typeof vi.fn> }
    eqChain.eq.mockImplementation((col: string, val: unknown) => {
      recorder.eqs.push({ col, val })
      return eqChain
    })
    const select = vi.fn().mockImplementation((cols: string) => {
      recorder.selected = cols
      return eqChain
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

  beforeEach(() => vi.clearAllMocks())

  it('returns the column value when a row exists', async () => {
    const { client, recorder } = buildReadClient({
      data: { reconfirmation_daily_cap: 75 },
      error: null,
    })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    const cap = await getReconfirmationDailyCap('r-1')

    expect(cap).toBe(75)
    expect(recorder.table).toBe('tenant_campaign_settings')
    expect(recorder.selected).toBe('reconfirmation_daily_cap')
    expect(recorder.eqs).toEqual([{ col: 'restaurant_id', val: 'r-1' }])
  })

  it('defaults to 50 when no row exists for the tenant', async () => {
    const { client } = buildReadClient({ data: null, error: null })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    const cap = await getReconfirmationDailyCap('r-empty')
    expect(cap).toBe(50)
  })

  it('defaults to 50 when the column itself is NULL (defensive)', async () => {
    const { client } = buildReadClient({
      data: { reconfirmation_daily_cap: null },
      error: null,
    })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    const cap = await getReconfirmationDailyCap('r-1')
    expect(cap).toBe(50)
  })

  it('throws contextually on database error', async () => {
    const { client } = buildReadClient({
      data: null,
      error: { message: 'permission denied' },
    })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    await expect(getReconfirmationDailyCap('r-1')).rejects.toThrow(
      /getReconfirmationDailyCap.*permission denied/
    )
  })
})

describe('setReconfirmationDailyCap (WONB-008)', () => {
  interface UpsertRecorder {
    table: string | null
    upserted: Record<string, unknown> | null
    upsertOpts: { onConflict?: string } | null
  }

  function buildUpsertClient(error: { message: string } | null = null): {
    client: ReturnType<typeof createServerSupabaseClient>
    recorder: UpsertRecorder
  } {
    const recorder: UpsertRecorder = {
      table: null,
      upserted: null,
      upsertOpts: null,
    }
    const upsert = vi
      .fn()
      .mockImplementation(
        (
          row: Record<string, unknown>,
          opts: { onConflict?: string } | undefined
        ) => {
          recorder.upserted = row
          recorder.upsertOpts = opts ?? null
          return Promise.resolve({ data: null, error })
        }
      )
    const from = vi.fn().mockImplementation((t: string) => {
      recorder.table = t
      return { upsert }
    })
    return {
      client: { from } as unknown as ReturnType<typeof createServerSupabaseClient>,
      recorder,
    }
  }

  beforeEach(() => vi.clearAllMocks())

  it('upserts the cap onto the tenant settings row (onConflict restaurant_id)', async () => {
    const { client, recorder } = buildUpsertClient()
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    await setReconfirmationDailyCap('r-1', 80)

    expect(recorder.table).toBe('tenant_campaign_settings')
    expect(recorder.upserted).toEqual({
      restaurant_id: 'r-1',
      reconfirmation_daily_cap: 80,
    })
    expect(recorder.upsertOpts).toEqual({ onConflict: 'restaurant_id' })
  })

  it('writes the value verbatim without range-validating (use case enforces 50–100)', async () => {
    // Repo is a dumb writer: validation happens at the application layer.
    // The DB CHECK constraint is the safety net (tests in supabase/migrations/050).
    const { client, recorder } = buildUpsertClient()
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    await setReconfirmationDailyCap('r-2', 100)

    expect(recorder.upserted).toEqual({
      restaurant_id: 'r-2',
      reconfirmation_daily_cap: 100,
    })
  })

  it('throws contextually on database error', async () => {
    const { client } = buildUpsertClient({ message: 'check_violation' })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    await expect(setReconfirmationDailyCap('r-1', 200)).rejects.toThrow(
      /setReconfirmationDailyCap.*check_violation/
    )
  })
})

describe('getReconfirmationSendsToday (WONB-008)', () => {
  // Two-step fetch: list campaign IDs in 'reconfirmation' mode for the
  // tenant, then count whatsapp_messages keyed by those campaign_ids since
  // start-of-today. Returns 0 when the tenant has no reconfirmation campaigns.
  interface CountRecorder {
    tables: string[]
    selects: string[]
    eqs: Array<{ col: string; val: unknown }>
    ins: Array<{ col: string; vals: unknown[] }>
    gtes: Array<{ col: string; val: unknown }>
  }

  function buildCountClient(args: {
    campaignIds: string[]
    countResult: { count: number | null; error: { message: string } | null }
  }): {
    client: ReturnType<typeof createServerSupabaseClient>
    recorder: CountRecorder
  } {
    const recorder: CountRecorder = {
      tables: [],
      selects: [],
      eqs: [],
      ins: [],
      gtes: [],
    }
    let callIdx = 0
    const from = vi.fn().mockImplementation((t: string) => {
      recorder.tables.push(t)
      const isFirst = callIdx++ === 0
      const eq = vi.fn().mockImplementation((col: string, val: unknown) => {
        recorder.eqs.push({ col, val })
        return chain
      })
      const inFn = vi.fn().mockImplementation((col: string, vals: unknown[]) => {
        recorder.ins.push({ col, vals })
        return chain
      })
      const gte = vi.fn().mockImplementation((col: string, val: unknown) => {
        recorder.gtes.push({ col, val })
        return chain
      })
      const chain: Record<string, unknown> = {
        eq,
        in: inFn,
        gte,
        then: undefined,
      }
      const select = vi.fn().mockImplementation((cols: string) => {
        recorder.selects.push(cols)
        if (isFirst) {
          // 1st call resolves with campaign rows.
          chain.then = (res: (v: unknown) => unknown) =>
            res({
              data: args.campaignIds.map((id) => ({ id })),
              error: null,
            })
        } else {
          // 2nd call resolves with the count.
          chain.then = (res: (v: unknown) => unknown) =>
            res({
              data: null,
              count: args.countResult.count,
              error: args.countResult.error,
            })
        }
        return chain
      })
      return { select }
    })
    return {
      client: { from } as unknown as ReturnType<typeof createServerSupabaseClient>,
      recorder,
    }
  }

  beforeEach(() => vi.clearAllMocks())

  it('returns 0 immediately when the tenant has no reconfirmation campaigns', async () => {
    const { client, recorder } = buildCountClient({
      campaignIds: [],
      countResult: { count: 0, error: null },
    })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    const n = await getReconfirmationSendsToday('r-1')
    expect(n).toBe(0)
    // Only the campaigns lookup happened — no message count round-trip.
    expect(recorder.tables).toEqual(['campaigns'])
  })

  it('counts whatsapp_messages for those campaigns since start-of-today', async () => {
    const { client, recorder } = buildCountClient({
      campaignIds: ['c-1', 'c-2'],
      countResult: { count: 17, error: null },
    })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    const n = await getReconfirmationSendsToday('r-1')
    expect(n).toBe(17)
    expect(recorder.tables).toEqual(['campaigns', 'whatsapp_messages'])
    expect(recorder.ins.find((i) => i.col === 'campaign_id')?.vals).toEqual([
      'c-1',
      'c-2',
    ])
    // Filter by today's start. We assert the value is an ISO string at a
    // midnight boundary in the server's local timezone (matches the helper
    // `todayStart()` semantics used elsewhere in this repo).
    const gteVal = recorder.gtes.find((g) => g.col === 'queued_at')?.val
    expect(typeof gteVal).toBe('string')
    expect(new Date(gteVal as string).getHours()).toBe(0)
    expect(new Date(gteVal as string).getMinutes()).toBe(0)
  })

  it('throws contextually on database error during count', async () => {
    const { client } = buildCountClient({
      campaignIds: ['c-1'],
      countResult: { count: null, error: { message: 'db down' } },
    })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    await expect(getReconfirmationSendsToday('r-1')).rejects.toThrow(
      /getReconfirmationSendsToday.*db down/
    )
  })
})
