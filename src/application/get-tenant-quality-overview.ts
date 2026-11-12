// WAQ-012: dashboard data assembly. Joins restaurants, latest
// tenant_quality_state, tenant_campaign_settings, and the marketing-window
// KPIs into one row per tenant.
//
// Why fetch in 3 parallel reads + JS join (vs a SQL view): the dashboard is
// per-tenant fan-out, the data set is small (≤ low-hundreds of tenants in
// MVP), and a SQL view would create a hidden coupling on column names that
// migrations 015/042 are still iterating on. Keep the join in code until
// scale forces a view. Also: the writer-of-record invariant on
// tenant_quality_state means we can rely on `transitioned_at DESC` as the
// deterministic "latest" tiebreaker.

import {
  getQualityKpisForAllTenants,
  getQualityKpisForTenant,
  type QualityKpis,
} from '@/infrastructure/supabase/repositories/quality-kpi-queries'
import type { QualityRating } from '@/domain/value-objects/quality-rating'
import {
  fetchRestaurants,
  fetchLatestQualityStates,
  fetchAutoPauseFlags,
  type RestaurantRow,
  type QualityStateLatest,
  type AutoPauseRow,
} from './get-tenant-quality-helpers'

export interface TenantQualityRow {
  restaurantId: string
  restaurantName: string
  qualityRating: QualityRating
  messagingTier: string | null
  autoPauseActive: boolean
  autoPauseReason: string | null
  kpis: QualityKpis
  lastTransitionedAt: string | null
}

interface OverviewArgs {
  windowDays: number
  filterRating?: 'GREEN' | 'YELLOW' | 'RED'
  now?: Date
}

interface SingleArgs {
  restaurantId: string
  windowDays: number
  now?: Date
}

const ZERO_KPIS: QualityKpis = {
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

function buildRow(
  r: RestaurantRow,
  state: QualityStateLatest | undefined,
  pause: AutoPauseRow | undefined,
  kpis: QualityKpis | undefined
): TenantQualityRow {
  return {
    restaurantId: r.id,
    restaurantName: r.name,
    qualityRating: state?.rating ?? 'UNKNOWN',
    messagingTier: state?.tier ?? null,
    autoPauseActive: pause?.active ?? false,
    autoPauseReason: pause?.reason ?? null,
    kpis: kpis ?? ZERO_KPIS,
    lastTransitionedAt: state?.transitionedAt ?? null,
  }
}

export async function getTenantQualityOverview(
  args: OverviewArgs
): Promise<TenantQualityRow[]> {
  const restaurants = await fetchRestaurants()
  const ids = restaurants.map((r) => r.id)
  const [states, pauses, kpiMap] = await Promise.all([
    fetchLatestQualityStates(ids),
    fetchAutoPauseFlags(ids),
    getQualityKpisForAllTenants({ windowDays: args.windowDays, now: args.now }),
  ])
  const rows = restaurants.map((r) =>
    buildRow(r, states.get(r.id), pauses.get(r.id), kpiMap.get(r.id))
  )
  return args.filterRating
    ? rows.filter((r) => r.qualityRating === args.filterRating)
    : rows
}

export async function getSingleTenantQuality(
  args: SingleArgs
): Promise<TenantQualityRow | null> {
  const { restaurantId, windowDays, now } = args
  const restaurants = await fetchRestaurants(restaurantId)
  if (restaurants.length === 0) return null
  const [states, pauses, kpis] = await Promise.all([
    fetchLatestQualityStates([restaurantId]),
    fetchAutoPauseFlags([restaurantId]),
    getQualityKpisForTenant({ restaurantId, windowDays, now }),
  ])
  return buildRow(
    restaurants[0],
    states.get(restaurantId),
    pauses.get(restaurantId),
    kpis
  )
}
