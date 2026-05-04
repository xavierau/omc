// WAQ-012: assemble per-tenant quality dashboard rows from
//   - restaurants (id, name)
//   - latest tenant_quality_state (rating, tier, transitioned_at)
//   - tenant_campaign_settings (auto_pause_active, auto_pause_reason)
//   - whatsapp_messages + consent_records (KPIs via getQualityKpisForAllTenants)
//
// Tenants without a quality_state row appear as UNKNOWN. Tenants without an
// auto-pause row appear as not-paused. Tenants with no marketing sends still
// appear (rating + zero KPIs) so the admin overview lists every tenant.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/infrastructure/supabase/client', () => ({
  createServerSupabaseClient: vi.fn(),
}))
vi.mock(
  '@/infrastructure/supabase/repositories/quality-kpi-queries',
  () => ({
    getQualityKpisForAllTenants: vi.fn(),
    getQualityKpisForTenant: vi.fn(),
  })
)

import { createServerSupabaseClient } from '@/infrastructure/supabase/client'
import {
  getQualityKpisForAllTenants,
  getQualityKpisForTenant,
} from '@/infrastructure/supabase/repositories/quality-kpi-queries'
import {
  getTenantQualityOverview,
  getSingleTenantQuality,
} from '../get-tenant-quality-overview'

type Row = Record<string, unknown>

function buildClient(rowsByTable: Record<string, Row[]>) {
  const from = vi.fn().mockImplementation((table: string) => {
    const rows = rowsByTable[table] ?? []
    return buildBuilder(rows)
  })
  return { from } as unknown as ReturnType<typeof createServerSupabaseClient>
}

function buildBuilder(rows: Row[]): Record<string, unknown> {
  const builder: Record<string, unknown> = {}
  // The chain is .select(...).eq?(...).maybeSingle?() OR chain that resolves
  // to {data, error} via thenable. Mirror enough of the real client surface.
  const terminal = {
    then: (resolve: (v: unknown) => void) =>
      resolve({ data: rows, error: null }),
  }
  const single = vi
    .fn()
    .mockResolvedValue({ data: rows[0] ?? null, error: null })
  const maybeSingle = vi
    .fn()
    .mockResolvedValue({ data: rows[0] ?? null, error: null })
  builder.select = vi.fn().mockReturnValue(builder)
  builder.eq = vi.fn().mockImplementation(() => ({
    ...builder,
    single,
    maybeSingle,
    then: terminal.then,
  }))
  builder.in = vi.fn().mockReturnValue(builder)
  builder.order = vi.fn().mockReturnValue(builder)
  builder.limit = vi.fn().mockReturnValue(builder)
  builder.maybeSingle = maybeSingle
  builder.single = single
  builder.then = terminal.then
  return builder
}

const ZERO_KPIS = {
  totalSends: 0,
  delivered: 0,
  read: 0,
  failed: 0,
  optedOut: 0,
  deliveryRate: 0,
  readRate: 0,
  errorRate: 0,
  optOutRate: 0,
}

beforeEach(() => vi.clearAllMocks())

describe('getTenantQualityOverview', () => {
  it('joins restaurants + latest quality_state + settings + KPIs into one row per tenant', async () => {
    const restaurants: Row[] = [
      { id: 'r-a', name: 'Alpha Diner' },
      { id: 'r-b', name: 'Beta Bistro' },
    ]
    const qualityStates: Row[] = [
      {
        restaurant_id: 'r-a',
        quality_rating: 'GREEN',
        messaging_tier: 'TIER_10K',
        transitioned_at: '2026-05-01T00:00:00Z',
      },
      {
        restaurant_id: 'r-b',
        quality_rating: 'YELLOW',
        messaging_tier: 'TIER_1K',
        transitioned_at: '2026-05-02T00:00:00Z',
      },
    ]
    const settings: Row[] = [
      {
        restaurant_id: 'r-b',
        auto_pause_active: true,
        auto_pause_reason: 'quality_red_auto',
      },
    ]
    vi.mocked(createServerSupabaseClient).mockReturnValue(
      buildClient({
        restaurants,
        tenant_quality_state: qualityStates,
        tenant_campaign_settings: settings,
      })
    )
    vi.mocked(getQualityKpisForAllTenants).mockResolvedValue(
      new Map([
        [
          'r-a',
          { ...ZERO_KPIS, totalSends: 100, delivered: 95, deliveryRate: 0.95 },
        ],
      ])
    )

    const rows = await getTenantQualityOverview({ windowDays: 7 })

    expect(rows).toHaveLength(2)
    const a = rows.find((r) => r.restaurantId === 'r-a')!
    expect(a.restaurantName).toBe('Alpha Diner')
    expect(a.qualityRating).toBe('GREEN')
    expect(a.messagingTier).toBe('TIER_10K')
    expect(a.autoPauseActive).toBe(false)
    expect(a.autoPauseReason).toBeNull()
    expect(a.kpis.totalSends).toBe(100)
    expect(a.lastTransitionedAt).toBe('2026-05-01T00:00:00Z')

    const b = rows.find((r) => r.restaurantId === 'r-b')!
    expect(b.qualityRating).toBe('YELLOW')
    expect(b.autoPauseActive).toBe(true)
    expect(b.autoPauseReason).toBe('quality_red_auto')
    // No KPI map entry — falls back to zero counters.
    expect(b.kpis).toEqual(ZERO_KPIS)
  })

  it('emits UNKNOWN rating for tenants with no quality_state history', async () => {
    vi.mocked(createServerSupabaseClient).mockReturnValue(
      buildClient({
        restaurants: [{ id: 'r-x', name: 'New Tenant' }],
        tenant_quality_state: [],
        tenant_campaign_settings: [],
      })
    )
    vi.mocked(getQualityKpisForAllTenants).mockResolvedValue(new Map())

    const rows = await getTenantQualityOverview({ windowDays: 7 })

    expect(rows).toHaveLength(1)
    expect(rows[0].qualityRating).toBe('UNKNOWN')
    expect(rows[0].messagingTier).toBeNull()
    expect(rows[0].autoPauseActive).toBe(false)
    expect(rows[0].lastTransitionedAt).toBeNull()
    expect(rows[0].kpis).toEqual(ZERO_KPIS)
  })

  it('uses the latest quality_state when a tenant has multiple events', async () => {
    // PostgREST sorts DESC by transitioned_at server-side; the reducer trusts
    // that order. Mirror that here: latest first.
    const states: Row[] = [
      {
        restaurant_id: 'r-a',
        quality_rating: 'YELLOW',
        messaging_tier: 'TIER_1K',
        transitioned_at: '2026-05-01T00:00:00Z',
      },
      {
        restaurant_id: 'r-a',
        quality_rating: 'GREEN',
        messaging_tier: 'TIER_10K',
        transitioned_at: '2026-04-01T00:00:00Z',
      },
    ]
    vi.mocked(createServerSupabaseClient).mockReturnValue(
      buildClient({
        restaurants: [{ id: 'r-a', name: 'Alpha' }],
        tenant_quality_state: states,
        tenant_campaign_settings: [],
      })
    )
    vi.mocked(getQualityKpisForAllTenants).mockResolvedValue(new Map())

    const rows = await getTenantQualityOverview({ windowDays: 7 })
    expect(rows[0].qualityRating).toBe('YELLOW')
    expect(rows[0].lastTransitionedAt).toBe('2026-05-01T00:00:00Z')
  })

  it('filters by rating when filterRating is provided', async () => {
    const states: Row[] = [
      {
        restaurant_id: 'r-a',
        quality_rating: 'GREEN',
        messaging_tier: 'TIER_10K',
        transitioned_at: '2026-05-01T00:00:00Z',
      },
      {
        restaurant_id: 'r-b',
        quality_rating: 'YELLOW',
        messaging_tier: 'TIER_1K',
        transitioned_at: '2026-05-02T00:00:00Z',
      },
    ]
    vi.mocked(createServerSupabaseClient).mockReturnValue(
      buildClient({
        restaurants: [
          { id: 'r-a', name: 'Alpha' },
          { id: 'r-b', name: 'Beta' },
        ],
        tenant_quality_state: states,
        tenant_campaign_settings: [],
      })
    )
    vi.mocked(getQualityKpisForAllTenants).mockResolvedValue(new Map())

    const rows = await getTenantQualityOverview({
      windowDays: 7,
      filterRating: 'YELLOW',
    })
    expect(rows.map((r) => r.restaurantId)).toEqual(['r-b'])
  })
})

describe('getSingleTenantQuality', () => {
  it('returns one row when the restaurant exists', async () => {
    vi.mocked(createServerSupabaseClient).mockReturnValue(
      buildClient({
        restaurants: [{ id: 'r-a', name: 'Alpha' }],
        tenant_quality_state: [
          {
            restaurant_id: 'r-a',
            quality_rating: 'GREEN',
            messaging_tier: 'TIER_10K',
            transitioned_at: '2026-05-01T00:00:00Z',
          },
        ],
        tenant_campaign_settings: [],
      })
    )
    vi.mocked(getQualityKpisForTenant).mockResolvedValue({
      ...ZERO_KPIS,
      totalSends: 50,
    })

    const row = await getSingleTenantQuality({
      restaurantId: 'r-a',
      windowDays: 7,
    })

    expect(row).not.toBeNull()
    expect(row!.restaurantId).toBe('r-a')
    expect(row!.qualityRating).toBe('GREEN')
    expect(row!.kpis.totalSends).toBe(50)
  })

  it('returns null when the restaurant does not exist', async () => {
    vi.mocked(createServerSupabaseClient).mockReturnValue(
      buildClient({
        restaurants: [],
        tenant_quality_state: [],
        tenant_campaign_settings: [],
      })
    )
    vi.mocked(getQualityKpisForTenant).mockResolvedValue(ZERO_KPIS)

    const row = await getSingleTenantQuality({
      restaurantId: 'r-missing',
      windowDays: 7,
    })

    expect(row).toBeNull()
  })
})
