// WAQ-011: trusted-tenant policy.
//
// Returns `{ trusted: true }` when the tenant has earned automatic
// approval — i.e. age >= 90 days AND no YELLOW/RED transitions in the
// last 90 days AND not currently auto-paused. Anything else returns
// `{ trusted: false, reason }` with one of three precedence-ordered
// reasons:
//
//   1) too_new                   (highest precedence — single read)
//   2) recent_quality_incident
//   3) auto_paused
//
// Computed on the fly. There is no `restaurants.trust_state` column —
// promotion is derivable from existing data, so a future flapping signal
// (auto-pause cleared then re-asserted) automatically demotes the tenant
// without a backfill.

import {
  getRestaurantCreatedAt,
  hasRecentQualityIncident,
  isTenantAutoPaused,
} from '@/infrastructure/supabase/repositories/tenant-trust-queries'

const TRUST_WINDOW_DAYS = 90
const MS_PER_DAY = 24 * 60 * 60 * 1000

export type TrustReason =
  | 'too_new'
  | 'recent_quality_incident'
  | 'auto_paused'

export interface TrustResult {
  trusted: boolean
  reason?: TrustReason
}

export interface IsTenantTrustedArgs {
  restaurantId: string
  now?: Date
}

export async function isTenantTrusted(
  args: IsTenantTrustedArgs
): Promise<TrustResult> {
  if (!args.restaurantId || !args.restaurantId.trim()) {
    throw new Error('isTenantTrusted: restaurantId is required')
  }
  const now = args.now ?? new Date()
  const ageDays = await tenantAgeDays(args.restaurantId, now)
  if (ageDays < TRUST_WINDOW_DAYS) return deny('too_new')

  const since = new Date(now.getTime() - TRUST_WINDOW_DAYS * MS_PER_DAY)
    .toISOString()
  const incident = await hasRecentQualityIncident({
    restaurantId: args.restaurantId,
    since,
  })
  if (incident) return deny('recent_quality_incident')

  const autoPaused = await isTenantAutoPaused(args.restaurantId)
  if (autoPaused) return deny('auto_paused')

  return { trusted: true }
}

async function tenantAgeDays(restaurantId: string, now: Date): Promise<number> {
  const createdAtIso = await getRestaurantCreatedAt(restaurantId)
  const createdAt = new Date(createdAtIso).getTime()
  return (now.getTime() - createdAt) / MS_PER_DAY
}

function deny(reason: TrustReason): TrustResult {
  return { trusted: false, reason }
}
