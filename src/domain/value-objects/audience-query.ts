// CAMP-016: the inputs of the one server-side audience resolver (migration
// 086) and the per-step counts it returns. The form's count and the send both
// build one of these; same query → same set.
import type { SkipContactQuality } from './audience-filters'

export type AudienceKind = 'all' | 'selected' | 'tag'

export interface AudienceQuery {
  restaurantId: string
  audience: AudienceKind
  tagIds: string[]
  /** 'selected' before the campaign exists (form preview). */
  memberIds: string[]
  /** 'selected' once the campaign exists (send): campaign_members. */
  campaignId: string | null
  /** null = no lapsed filter. */
  lapsedDays: number | null
  /** false only for pre-086 win-back campaigns (old read excluded never-visited members). */
  neverVisitedIsLapsed: boolean
  skip: SkipContactQuality
}

export interface AudienceCounts {
  /** Active members in the audience before any filter. */
  audience: number
  /** After the lapsed filter (equals audience when there is none). */
  afterLapsed: number
  /** Quality distribution of the after-lapsed set. */
  green: number
  yellow: number
  red: number
  noData: number
  /** After the quality skip: the set the send resolves to. */
  willReceive: number
}
