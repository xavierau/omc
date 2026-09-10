import { createServerSupabaseClient } from '@/infrastructure/supabase/client'
import { Campaign } from '@/domain/entities/campaign'
import { Member } from '@/domain/entities/member'
import { getCampaignTagIds } from '@/infrastructure/supabase/repositories/campaign-tags-repository'
import { dedupeById, readAllPages } from './resolve-campaign-members-chunks'

// Exported so the migration-079 contract test can tie the RPCs' RETURNS
// TABLE column list to the columns mapRowToMember actually consumes (D8).
export const MEMBER_COLUMNS =
  'id, restaurant_id, phone, name, points_balance, status, joined_at, last_visit_at, preferred_language, pmm_throttled_until, unreachable_at'

export async function resolveTargetMembers(
  campaign: Campaign,
  restaurantId: string
): Promise<Member[]> {
  if (campaign.targetAudience === 'selected') {
    return fetchSelectedMembers(campaign.id, restaurantId)
  }
  if (campaign.targetAudience === 'tag') {
    return fetchTagMembers(campaign, restaurantId)
  }
  if (campaign.type === 'winback') {
    return fetchWinbackMembers(campaign, restaurantId)
  }
  if (campaign.type === 'promo') {
    return fetchActiveMembers(restaurantId)
  }
  if (campaign.type === 'birthday') {
    console.warn('Birthday campaigns not yet supported')
    return []
  }
  return []
}

// The active-member half of the promo and winback reads. Both branches page
// it: an unpaged select is truncated at the project's `max-rows` (1000) with
// NO error, and #161 is what makes that reachable -- before it every tenant
// was capped at 1,000 sends/month anyway, after it a growth tenant enforces
// 10,000 and the read cap is the only thing left silently deciding who is
// left out of a campaign the worker then marks completed (review F1).
// `.order('id')` supplies the total order readAllPages requires.
function activeMembersOf(
  supabase: ReturnType<typeof createServerSupabaseClient>,
  restaurantId: string
) {
  return supabase
    .from('members')
    .select(MEMBER_COLUMNS)
    .eq('restaurant_id', restaurantId)
    .eq('status', 'active')
}

async function fetchWinbackMembers(
  campaign: Campaign,
  restaurantId: string
): Promise<Member[]> {
  const inactiveDays = (campaign.schedule as { inactiveDays?: number })
    ?.inactiveDays ?? 30
  const cutoff = new Date(
    Date.now() - inactiveDays * 24 * 60 * 60 * 1000
  ).toISOString()

  const supabase = createServerSupabaseClient()
  const rows = await readAllPages<Record<string, unknown>>(
    'fetchWinbackMembers',
    (from, to) =>
      activeMembersOf(supabase, restaurantId)
        .lt('last_visit_at', cutoff)
        .order('id')
        .range(from, to)
  )
  return dedupeById(rows.map(mapRowToMember))
}

async function fetchActiveMembers(
  restaurantId: string
): Promise<Member[]> {
  const supabase = createServerSupabaseClient()
  const rows = await readAllPages<Record<string, unknown>>(
    'fetchActiveMembers',
    (from, to) => activeMembersOf(supabase, restaurantId).order('id').range(from, to)
  )
  return dedupeById(rows.map(mapRowToMember))
}

// Recipients resolve INSIDE the database (migration 079). The old shape read
// campaign_members, then fed every member UUID back through `.in('id', ids)`;
// PostgREST echoes that query in the `content-location` response header and
// undici aborts the read above ~390 ids, failing the campaign (#162).
async function fetchSelectedMembers(
  campaignId: string,
  restaurantId: string
): Promise<Member[]> {
  const supabase = createServerSupabaseClient()
  const rows = await readAllPages<Record<string, unknown>>(
    'fetchSelectedMembers',
    (from, to) =>
      supabase.rpc('active_members_by_campaign_selection', {
        p_restaurant_id: restaurantId,
        p_campaign_id: campaignId,
        p_limit: to - from + 1,
        p_offset: from,
      })
  )
  return dedupeById(rows.map(mapRowToMember))
}

// Target-by-tag resolves to whoever carries the linked tag(s) at SEND time
// (dynamic membership). The member_tags/members join now runs in Postgres
// (migration 079) instead of as a two-step client-side join: tenant-scoped
// by BOTH restaurant_id predicates, deduped by DISTINCT ON (m.id) so a
// member carrying two selected tags is one recipient, and selecting exactly
// the set RPC 067 counts. Still paged -- a set-returning RPC is subject to
// PostgREST `max-rows` too -- but with p_limit/p_offset, never by shipping
// member ids back into a URL filter.
async function fetchTagMembers(
  campaign: Campaign,
  restaurantId: string
): Promise<Member[]> {
  const tagIds = await getCampaignTagIds(campaign.id)
  if (tagIds.length === 0) return []
  const supabase = createServerSupabaseClient()
  const rows = await readAllPages<Record<string, unknown>>(
    'fetchTagMembers',
    (from, to) =>
      supabase.rpc('active_members_by_tags', {
        p_restaurant_id: restaurantId,
        p_tag_ids: tagIds,
        p_limit: to - from + 1,
        p_offset: from,
      })
  )
  return dedupeById(rows.map(mapRowToMember))
}

function mapRowToMember(row: Record<string, unknown>): Member {
  return {
    id: row.id as string,
    restaurantId: row.restaurant_id as string,
    phone: row.phone as string,
    name: (row.name as string) ?? null,
    pointsBalance: Number(row.points_balance ?? 0),
    status: row.status as Member['status'],
    joinedAt: row.joined_at as string,
    lastVisitAt: (row.last_visit_at as string) ?? null,
    preferredLanguage: (row.preferred_language as string) ?? null,
    pmmThrottledUntil: (row.pmm_throttled_until as string) ?? null,
    unreachableAt: (row.unreachable_at as string) ?? null,
  }
}
