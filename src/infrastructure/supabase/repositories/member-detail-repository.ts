import { createServerSupabaseClient } from '../client'
import type { MemberRow, MemberTagLite } from './member-repository'

export interface MemberDetail extends MemberRow {
  restaurant_id: string
  receipts: { id: string; total_amount: number; points_awarded: number; created_at: string; status: string }[]
  coupons: { id: string; code: string; type: string; status: string; redeemed_at: string | null }[]
  visitCount: number
}

// PGRST116 is PostgREST's "no rows" answer to `.single()`; 22P02 is
// Postgres's invalid-uuid input error. Both mean the (member, restaurant)
// pair does not resolve — a miss. Everything else (connection failures,
// timeouts, schema drift) is a real error and must not read as 404.
function isMissError(error: { code?: string }): boolean {
  return error.code === 'PGRST116' || error.code === '22P02'
}

// Explicit column allowlist, mirroring getMembers: the full members row
// also carries loyalty_token — a bearer secret the loyalty-card flow
// authenticates by — plus internal ops columns, none of which may reach
// the dashboard browser.
const MEMBER_DETAIL_COLUMNS =
  'id, phone, name, points_balance, status, joined_at, last_visit_at, preferred_language, restaurant_id'

/**
 * Scoped-query tenant isolation (#111) — same pattern as SEC-001's
 * `findByIdForRestaurant` for wa-templates and #102's
 * `getCampaignByIdForRestaurant`. A foreign id resolves to null exactly
 * like a missing one: no fetch-then-compare, no existence leak, ids stay
 * non-enumerable. Only a genuine miss maps to null — any other database
 * error throws, so outages surface as 500s rather than "Member not found".
 */
export async function getMemberDetailForRestaurant(
  memberId: string,
  restaurantId: string
): Promise<MemberDetail | null> {
  const supabase = createServerSupabaseClient()

  const [memberRes, receiptsRes, couponsRes, tagsRes] = await Promise.all([
    supabase.from('members').select(MEMBER_DETAIL_COLUMNS).eq('id', memberId).eq('restaurant_id', restaurantId).single(),
    supabase
      .from('receipts')
      .select('id, total_amount, points_awarded, created_at, status')
      .eq('member_id', memberId)
      .eq('restaurant_id', restaurantId)
      .order('created_at', { ascending: false })
      .limit(20),
    supabase
      .from('coupons')
      .select('id, code, type, status, redeemed_at')
      .eq('member_id', memberId)
      .eq('restaurant_id', restaurantId)
      .order('created_at', { ascending: false }),
    supabase
      .from('member_tags')
      .select('tags(id, name, color)')
      .eq('member_id', memberId)
      .eq('restaurant_id', restaurantId),
  ])

  if (memberRes.error) {
    if (isMissError(memberRes.error)) return null
    throw new Error(`getMemberDetailForRestaurant(members): ${memberRes.error.message}`)
  }
  if (!memberRes.data) return null
  if (receiptsRes.error) {
    throw new Error(`getMemberDetailForRestaurant(receipts): ${receiptsRes.error.message}`)
  }
  if (couponsRes.error) {
    throw new Error(`getMemberDetailForRestaurant(coupons): ${couponsRes.error.message}`)
  }
  // Same contract as the receipts/coupons branches: a failed read must surface
  // as a 500, not as a member who convincingly appears to carry no tags
  // (review round 2, finding 9).
  if (tagsRes.error) {
    throw new Error(`getMemberDetailForRestaurant(tags): ${tagsRes.error.message}`)
  }

  return {
    ...(memberRes.data as MemberRow & { restaurant_id: string }),
    receipts: (receiptsRes.data ?? []) as MemberDetail['receipts'],
    coupons: (couponsRes.data ?? []) as MemberDetail['coupons'],
    visitCount: receiptsRes.data?.length ?? 0,
    tags: toMemberTags(tagsRes.data),
  }
}

function toMemberTags(data: unknown): MemberTagLite[] {
  if (!Array.isArray(data)) return []
  return data
    .map((r) => (r as { tags?: MemberTagLite | null }).tags)
    .filter((t): t is MemberTagLite => Boolean(t))
}
