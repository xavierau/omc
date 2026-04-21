import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../client', () => ({
  createServerSupabaseClient: vi.fn(),
}))

import { createServerSupabaseClient } from '../../client'
import { getMonthlyTenantSends } from '../campaign-settings-repository'

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
