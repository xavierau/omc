// CAMP-016: build the resolver query for a saved campaign (the send) and for
// the campaign form (the count). Both end in the same AudienceQuery shape, so
// the number the form shows and the set the send resolves are one predicate.
import type { Campaign } from '@/domain/entities/campaign'
import type { AudienceKind, AudienceQuery } from '@/domain/value-objects/audience-query'
import type { SkipContactQuality } from '@/domain/value-objects/audience-filters'

/** Types an 'all' audience sends to; others (welcome, birthday) resolve to nobody here. */
const BROADCAST_TYPES: ReadonlyArray<Campaign['type']> = ['promo', 'winback']

const LEGACY_WINBACK_DAYS = 30

/**
 * A pre-086 win-back campaign (no snapshot) keeps its old read: `all`
 * audience, `schedule.inactiveDays` (default 30), never-visited members
 * excluded. Every win-back created since 086 carries its lapsed days.
 */
function isLegacyWinback(c: Campaign): boolean {
  return c.type === 'winback' && c.targetAudience === 'all' && c.audienceLapsedDays == null
}

function legacyInactiveDays(c: Campaign): number {
  const days = (c.schedule as { inactiveDays?: unknown } | null)?.inactiveDays
  return typeof days === 'number' && days > 0 ? days : LEGACY_WINBACK_DAYS
}

/** The send's query, from the campaign's snapshot. null = nobody to resolve. */
export function audienceQueryForCampaign(
  campaign: Campaign,
  restaurantId: string,
  tagIds: string[]
): AudienceQuery | null {
  if (campaign.targetAudience === 'all' && !BROADCAST_TYPES.includes(campaign.type)) return null
  if (campaign.targetAudience === 'tag' && tagIds.length === 0) return null
  const legacy = isLegacyWinback(campaign)
  return {
    restaurantId,
    audience: campaign.targetAudience,
    tagIds,
    memberIds: [],
    campaignId: campaign.targetAudience === 'selected' ? campaign.id : null,
    lapsedDays: legacy ? legacyInactiveDays(campaign) : (campaign.audienceLapsedDays ?? null),
    neverVisitedIsLapsed: !legacy,
    skip: campaign.audienceSkipQuality ?? 'off',
  }
}

export interface AudiencePreviewInput {
  restaurantId: string
  audience: AudienceKind
  tagIds: string[]
  memberIds: string[]
  lapsedDays: number | null
  skip: SkipContactQuality
}

/** The form's query: the same filters, the selection given by member ids. */
export function audienceQueryForPreview(input: AudiencePreviewInput): AudienceQuery {
  return {
    restaurantId: input.restaurantId,
    audience: input.audience,
    tagIds: input.audience === 'tag' ? input.tagIds : [],
    memberIds: input.audience === 'selected' ? input.memberIds : [],
    campaignId: null,
    lapsedDays: input.lapsedDays,
    neverVisitedIsLapsed: true,
    skip: input.skip,
  }
}
