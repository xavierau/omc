// resolveScanIdentity — "scan any QR" → memberId (plan §4.2). Ordered strategy,
// first hit wins, ALL tenant-scoped:
//   1. LOYALTY:<token>  → tenant-scoped loyalty lookup.
//   2. Coupon code      → findCouponByCode (service-role, NOT tenant-scoped) then a
//                         HARD cross-tenant gate on coupon.restaurant_id. A mismatch
//                         is an IMMEDIATE not_resolved — never warn-and-continue,
//                         never fall through with another tenant's member.
// Resolves off the PERSISTENT member link even when the coupon is expired/redeemed.
//
// NOTE: JOIN-<id> deep-link enrollment (§4.2 strat 2 / §9) is the on-the-spot
// enrollment backstop; there is no existing memberId-resolver to reuse, so an
// unresolved scan returns not_resolved and the UI offers phone-lookup / add-member.
import { findCouponByCode } from '@/infrastructure/supabase/repositories/coupon-repository'
import { findMemberByLoyaltyToken } from '@/infrastructure/supabase/repositories/member-loyalty-repository'

export type ResolveScanResult = { memberId: string } | { error: 'not_resolved' }

const NOT_RESOLVED: ResolveScanResult = { error: 'not_resolved' }
const LOYALTY_RE = /^LOYALTY:(.+)$/
const REDEEM_PREFIX_RE = /^REDEEM\s+/i

export async function resolveScanIdentity(
  rawScan: string,
  restaurantId: string
): Promise<ResolveScanResult> {
  const scan = rawScan.trim()
  if (!scan) return NOT_RESOLVED

  const loyalty = scan.match(LOYALTY_RE)
  if (loyalty) return resolveLoyalty(loyalty[1], restaurantId)

  return resolveCoupon(scan, restaurantId)
}

async function resolveLoyalty(
  token: string,
  restaurantId: string
): Promise<ResolveScanResult> {
  const memberId = await findMemberByLoyaltyToken(token, restaurantId)
  return memberId ? { memberId } : NOT_RESOLVED
}

async function resolveCoupon(
  scan: string,
  restaurantId: string
): Promise<ResolveScanResult> {
  const code = scan.replace(REDEEM_PREFIX_RE, '').trim().toUpperCase()
  if (!code) return NOT_RESOLVED

  const coupon = await findCouponByCode(code)
  if (!coupon) return NOT_RESOLVED
  // HARD cross-tenant gate — the SOLE barrier (findCouponByCode bypasses RLS).
  if (coupon.restaurantId !== restaurantId) return NOT_RESOLVED
  if (!coupon.memberId) return NOT_RESOLVED

  return { memberId: coupon.memberId }
}
