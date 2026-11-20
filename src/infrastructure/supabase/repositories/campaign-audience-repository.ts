// CAMP-016: the campaign audience resolver RPCs (migration 086). Service-role
// client; the routes that call countAudience return aggregates only (R2).
// Window and thresholds come from contact-quality.ts, the single source the
// members-table badge also classifies with.
import { createServerSupabaseClient } from '../client'
import {
  CONTACT_QUALITY_THRESHOLDS,
  CONTACT_QUALITY_WINDOW_DAYS,
} from '@/domain/value-objects/contact-quality'
import type { AudienceCounts, AudienceQuery } from '@/domain/value-objects/audience-query'

/** The named RPC arguments both functions share: one filter definition. */
export function audienceRpcArgs(q: AudienceQuery): Record<string, unknown> {
  return {
    p_restaurant_id: q.restaurantId,
    p_audience: q.audience,
    p_tag_ids: q.audience === 'tag' ? q.tagIds : null,
    p_member_ids: q.audience === 'selected' && !q.campaignId ? q.memberIds : null,
    p_campaign_id: q.audience === 'selected' ? q.campaignId : null,
    p_lapsed_days: q.lapsedDays,
    p_never_visited_lapsed: q.neverVisitedIsLapsed,
    p_skip: q.skip,
    p_window_days: CONTACT_QUALITY_WINDOW_DAYS,
    p_green: CONTACT_QUALITY_THRESHOLDS.green,
    p_yellow: CONTACT_QUALITY_THRESHOLDS.yellow,
  }
}

/** One keyset page of recipients for readAllPagesAfterId (id > afterId, ORDER BY id in SQL). */
export function fetchAudienceMembersPage(q: AudienceQuery, afterId: string | null, limit: number) {
  return createServerSupabaseClient().rpc('campaign_audience_members', {
    ...audienceRpcArgs(q),
    p_limit: limit,
    p_after_id: afterId,
  })
}

interface CountsRow {
  audience: number
  after_lapsed: number
  green: number
  yellow: number
  red: number
  no_data: number
  will_receive: number
}

export async function countAudience(q: AudienceQuery): Promise<AudienceCounts> {
  const { data, error } = await createServerSupabaseClient().rpc(
    'campaign_audience_counts',
    audienceRpcArgs(q)
  )
  if (error) throw new Error(`countAudience: ${error.message}`)
  const row = (Array.isArray(data) ? data[0] : data) as CountsRow | undefined
  return {
    audience: Number(row?.audience ?? 0),
    afterLapsed: Number(row?.after_lapsed ?? 0),
    green: Number(row?.green ?? 0),
    yellow: Number(row?.yellow ?? 0),
    red: Number(row?.red ?? 0),
    noData: Number(row?.no_data ?? 0),
    willReceive: Number(row?.will_receive ?? 0),
  }
}
