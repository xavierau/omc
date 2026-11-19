import { Campaign } from '@/domain/entities/campaign'
import { Member } from '@/domain/entities/member'
import { getCampaignTagIds } from '@/infrastructure/supabase/repositories/campaign-tags-repository'
import { fetchAudienceMembersPage } from '@/infrastructure/supabase/repositories/campaign-audience-repository'
import { dedupeById, readAllPagesAfterId } from './resolve-campaign-members-chunks'
import { audienceQueryForCampaign } from './campaign-audience-query'

// Exported so the migration-079 contract test can tie the RPCs' RETURNS
// TABLE column list to the columns mapRowToMember actually consumes (D8).
// Migration 086's campaign_audience_members returns the same list.
export const MEMBER_COLUMNS =
  'id, restaurant_id, phone, name, points_balance, status, joined_at, last_visit_at, preferred_language, pmm_throttled_until, unreachable_at'

// CAMP-016: every audience (all | selected | tag) resolves through ONE
// database function, campaign_audience_members (migration 086), with the
// campaign's snapshotted filters: lapsed days and the quality skip level. The
// form's recipient count calls campaign_audience_counts over the same
// predicate, so what the merchant is shown is what is sent (count/send parity).
// The lapsed filter now composes with tags and selections; before 086 a
// tag/selected audience silently dropped win-back's last-visit filter.
//
// Recipients never leave the database as an id list (#162): selection and tag
// membership are joined in SQL, and the walk is keyset paged (p_limit +
// p_after_id) because a set-returning RPC is truncated at PostgREST max-rows
// too, and an OFFSET walk drops a row when a member's rating changes mid-walk.
export async function resolveTargetMembers(
  campaign: Campaign,
  restaurantId: string
): Promise<Member[]> {
  if (campaign.targetAudience === 'all' && campaign.type === 'birthday') {
    console.warn('Birthday campaigns not yet supported')
    return []
  }
  const tagIds = campaign.targetAudience === 'tag' ? await getCampaignTagIds(campaign.id) : []
  const query = audienceQueryForCampaign(campaign, restaurantId, tagIds)
  if (!query) return []
  const rows = await readAllPagesAfterId<Record<string, unknown> & { id: string }>(
    'resolveTargetMembers',
    (afterId, limit) => fetchAudienceMembersPage(query, afterId, limit)
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
