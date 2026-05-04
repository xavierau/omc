// WAQ-012 quality-dashboard KPI aggregations.
//
// Aggregation runs server-side (review fix r1, Fix 1) via the RPCs in
// migration 045 — no more raw row pulls. These tests verify:
//   * the JS layer hands the right args to the right RPC,
//   * BIGINT-as-string responses are coerced safely,
//   * rate derivation distinguishes "no sends" (NaN) from "perfect" (0),
//   * the bulk variant returns one entry per restaurant_id.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../client', () => ({
  createServerSupabaseClient: vi.fn(),
}))

import { createServerSupabaseClient } from '../../client'
import {
  getQualityKpisForTenant,
  getQualityKpisForAllTenants,
} from '../quality-kpi-queries'

type SupabaseClient = ReturnType<typeof createServerSupabaseClient>

interface RpcResult {
  data?: unknown
  error?: { message: string } | null
}

function buildRpcClient(
  responsesByName: Record<string, RpcResult>
): { client: SupabaseClient; rpc: ReturnType<typeof vi.fn> } {
  const rpc = vi.fn().mockImplementation((name: string) => {
    const result = responsesByName[name] ?? { data: [], error: null }
    return Promise.resolve({
      data: result.data ?? null,
      error: result.error ?? null,
    })
  })
  return { client: { rpc } as unknown as SupabaseClient, rpc }
}

beforeEach(() => vi.clearAllMocks())

describe('getQualityKpisForTenant', () => {
  it('calls get_quality_kpis_for_tenant with the restaurant + window cutoff and maps the row', async () => {
    const now = new Date('2026-05-04T00:00:00.000Z')
    const { client, rpc } = buildRpcClient({
      get_quality_kpis_for_tenant: {
        data: [
          {
            total_sends: 6,
            delivered: 3,
            read_count: 1,
            failed: 1,
            opted_out: 1,
          },
        ],
      },
    })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    const kpis = await getQualityKpisForTenant({
      restaurantId: 'rest-1',
      windowDays: 7,
      now,
    })

    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('get_quality_kpis_for_tenant', {
      p_restaurant_id: 'rest-1',
      p_since: new Date(now.getTime() - 7 * 24 * 3600_000).toISOString(),
    })

    expect(kpis.totalSends).toBe(6)
    expect(kpis.delivered).toBe(3)
    expect(kpis.read).toBe(1)
    expect(kpis.failed).toBe(1)
    expect(kpis.optedOut).toBe(1)
    expect(kpis.deliveryRate).toBeCloseTo(3 / 6)
    expect(kpis.readRate).toBeCloseTo(1 / 3)
    expect(kpis.errorRate).toBeCloseTo(1 / 6)
    expect(kpis.optOutRate).toBeCloseTo(1 / 6)
  })

  it('coerces BIGINT-as-string responses to numbers', async () => {
    // PostgREST may serialize BIGINT as a string in some configs.
    const { client } = buildRpcClient({
      get_quality_kpis_for_tenant: {
        data: [
          {
            total_sends: '10',
            delivered: '7',
            read_count: '4',
            failed: '1',
            opted_out: '2',
          },
        ],
      },
    })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    const kpis = await getQualityKpisForTenant({
      restaurantId: 'rest-1',
      windowDays: 7,
    })

    expect(kpis.totalSends).toBe(10)
    expect(kpis.delivered).toBe(7)
    expect(kpis.deliveryRate).toBeCloseTo(0.7)
  })

  it('returns NaN rates when there are no sends (distinguishes empty from perfect)', async () => {
    // Review fix r1, Fix 2: zero-denominator → NaN so the UI can render
    // '—' for "no data" and '0.0%' for "many sends, no failures".
    const { client } = buildRpcClient({
      get_quality_kpis_for_tenant: {
        data: [
          {
            total_sends: 0,
            delivered: 0,
            read_count: 0,
            failed: 0,
            opted_out: 0,
          },
        ],
      },
    })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    const kpis = await getQualityKpisForTenant({
      restaurantId: 'rest-empty',
      windowDays: 7,
    })

    expect(kpis.totalSends).toBe(0)
    expect(Number.isNaN(kpis.deliveryRate)).toBe(true)
    expect(Number.isNaN(kpis.readRate)).toBe(true)
    expect(Number.isNaN(kpis.errorRate)).toBe(true)
    expect(Number.isNaN(kpis.optOutRate)).toBe(true)
  })

  it('falls back to zero counters when the RPC returns no rows', async () => {
    const { client } = buildRpcClient({
      get_quality_kpis_for_tenant: { data: [] },
    })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    const kpis = await getQualityKpisForTenant({
      restaurantId: 'rest-empty',
      windowDays: 7,
    })

    expect(kpis.totalSends).toBe(0)
    expect(Number.isNaN(kpis.deliveryRate)).toBe(true)
  })

  it('returns 0 (not NaN) when there are sends but no failures', async () => {
    // Review fix r1, Fix 2: 100 sends with 0 failures should report
    // errorRate=0 (a finite number), so the UI shows '0.0%' rather than
    // the same dash as "no sends at all".
    const { client } = buildRpcClient({
      get_quality_kpis_for_tenant: {
        data: [
          {
            total_sends: 100,
            delivered: 100,
            read_count: 50,
            failed: 0,
            opted_out: 0,
          },
        ],
      },
    })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    const kpis = await getQualityKpisForTenant({
      restaurantId: 'rest-1',
      windowDays: 7,
    })

    expect(kpis.errorRate).toBe(0)
    expect(kpis.optOutRate).toBe(0)
    expect(Number.isFinite(kpis.errorRate)).toBe(true)
    expect(Number.isFinite(kpis.optOutRate)).toBe(true)
  })

  it('throws a contextual error when the RPC fails', async () => {
    const { client } = buildRpcClient({
      get_quality_kpis_for_tenant: { error: { message: 'db down' } },
    })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    await expect(
      getQualityKpisForTenant({ restaurantId: 'rest-1', windowDays: 7 })
    ).rejects.toThrow(/getQualityKpisForTenant/)
  })

})

describe('getQualityKpisForAllTenants', () => {
  it('groups KPIs by restaurant_id (one row per tenant)', async () => {
    const now = new Date('2026-05-04T00:00:00.000Z')
    const { client, rpc } = buildRpcClient({
      get_quality_kpis_for_all_tenants: {
        data: [
          {
            restaurant_id: 'a',
            total_sends: 4,
            delivered: 2,
            read_count: 1,
            failed: 1,
            opted_out: 2,
          },
          {
            restaurant_id: 'b',
            total_sends: 2,
            delivered: 1,
            read_count: 0,
            failed: 0,
            opted_out: 1,
          },
        ],
      },
    })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    const map = await getQualityKpisForAllTenants({ windowDays: 7, now })

    expect(rpc).toHaveBeenCalledWith('get_quality_kpis_for_all_tenants', {
      p_since: new Date(now.getTime() - 7 * 24 * 3600_000).toISOString(),
    })

    const a = map.get('a')!
    expect(a.totalSends).toBe(4)
    expect(a.delivered).toBe(2)
    expect(a.read).toBe(1)
    expect(a.failed).toBe(1)
    expect(a.optedOut).toBe(2)
    expect(a.deliveryRate).toBeCloseTo(2 / 4)
    expect(a.readRate).toBeCloseTo(1 / 2)
    expect(a.errorRate).toBeCloseTo(1 / 4)
    expect(a.optOutRate).toBeCloseTo(2 / 4)

    const b = map.get('b')!
    expect(b.totalSends).toBe(2)
    expect(b.delivered).toBe(1)
    expect(b.optedOut).toBe(1)
  })

  it('returns an empty map when the RPC yields no rows', async () => {
    const { client } = buildRpcClient({
      get_quality_kpis_for_all_tenants: { data: [] },
    })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    const map = await getQualityKpisForAllTenants({ windowDays: 7 })
    expect(map.size).toBe(0)
  })

  it('still emits a row for tenants with only opt-outs (no sends)', async () => {
    const { client } = buildRpcClient({
      get_quality_kpis_for_all_tenants: {
        data: [
          {
            restaurant_id: 'c',
            total_sends: 0,
            delivered: 0,
            read_count: 0,
            failed: 0,
            opted_out: 1,
          },
        ],
      },
    })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    const map = await getQualityKpisForAllTenants({ windowDays: 7 })
    const c = map.get('c')!
    expect(c.totalSends).toBe(0)
    expect(c.optedOut).toBe(1)
    expect(Number.isNaN(c.optOutRate)).toBe(true)
  })

  it('throws a contextual error when the RPC fails', async () => {
    const { client } = buildRpcClient({
      get_quality_kpis_for_all_tenants: { error: { message: 'db down' } },
    })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    await expect(
      getQualityKpisForAllTenants({ windowDays: 7 })
    ).rejects.toThrow(/getQualityKpisForAllTenants/)
  })
})
