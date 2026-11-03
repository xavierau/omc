// WAQ-011-DETAIL: everything a platform admin needs to judge a template
// review — the full template, every campaign that sends it, and readable
// names instead of ids. Read-only. Callers (admin routes) MUST have run
// assertPlatformAdmin first: these lookups cross tenants.

import type { TemplateReview, TemplateReviewProps } from '@/domain/entities/template-review'
import type { WhatsAppTemplate } from '@/domain/entities/whatsapp-template'
import { findTemplateReviewById } from '@/infrastructure/supabase/repositories/template-review-repository'
import { findByIdForRestaurant } from '@/infrastructure/supabase/repositories/whatsapp-template-repository'
import { getCampaignTagIds } from '@/infrastructure/supabase/repositories/campaign-tags-repository'
import { countActiveMembersByTags } from '@/infrastructure/supabase/repositories/tag-audience-repository'
import { findRestaurantNamesByIds, findUserEmailById } from '@/infrastructure/supabase/repositories/admin-identity-lookups'
import {
  findLatestTemplateByNameForRestaurant,
  listCampaignsUsingTemplate,
  countCampaignMembers,
  type TemplateCampaignRow,
} from '@/infrastructure/supabase/repositories/template-review-detail-queries'

export interface TemplateReviewDetailDeps {
  findReviewById(id: string): Promise<TemplateReview | null>
  findRestaurantNames(ids: string[]): Promise<Map<string, string>>
  findUserEmail(userId: string): Promise<string | null>
  findTemplateById(id: string, restaurantId: string): Promise<WhatsAppTemplate | null>
  findLatestTemplateByName(restaurantId: string, name: string): Promise<WhatsAppTemplate | null>
  listCampaignsUsingTemplate(restaurantId: string, templateId: string): Promise<TemplateCampaignRow[]>
  getCampaignTagIds(campaignId: string): Promise<string[]>
  countActiveMembersByTags(tagIds: string[], restaurantId: string): Promise<number>
  countCampaignMembers(campaignId: string): Promise<number>
}

const defaultDeps: TemplateReviewDetailDeps = {
  findReviewById: findTemplateReviewById,
  findRestaurantNames: findRestaurantNamesByIds,
  findUserEmail: findUserEmailById,
  findTemplateById: findByIdForRestaurant,
  findLatestTemplateByName: findLatestTemplateByNameForRestaurant,
  listCampaignsUsingTemplate,
  getCampaignTagIds,
  countActiveMembersByTags,
  countCampaignMembers,
}

export type TemplateReviewDetailTemplate = Pick<
  WhatsAppTemplate,
  'id' | 'name' | 'language' | 'category' | 'status' | 'components'
>

export interface TemplateReviewDetailCampaign extends TemplateCampaignRow {
  /** null = unknown (an 'all' audience, or the count failed) — the UI shows '—'. */
  audienceSize: number | null
}

export interface TemplateReviewDetail {
  review: TemplateReviewProps
  restaurant: { id: string; name: string | null }
  submitterEmail: string | null
  template: TemplateReviewDetailTemplate | null
  campaigns: TemplateReviewDetailCampaign[]
}

export type EnrichedTemplateReview = TemplateReviewProps & {
  restaurantName: string | null
  submitterEmail: string | null
}

export async function getTemplateReviewDetail(
  reviewId: string,
  deps: TemplateReviewDetailDeps = defaultDeps
): Promise<TemplateReviewDetail | null> {
  const found = await deps.findReviewById(reviewId)
  if (!found) return null
  const review = { ...found.snapshot }
  const [[enriched], template] = await Promise.all([
    enrichTemplateReviews([review], deps),
    resolveTemplate(review, deps),
  ])
  const campaigns = template ? await loadCampaigns(review.restaurantId, template.id, deps) : []
  return {
    review,
    restaurant: { id: review.restaurantId, name: enriched.restaurantName },
    submitterEmail: enriched.submitterEmail,
    template: template ? pickTemplate(template) : null,
    campaigns,
  }
}

/** One restaurant query for the whole list; one email lookup per distinct submitter. */
export async function enrichTemplateReviews(
  reviews: TemplateReviewProps[],
  deps: Pick<TemplateReviewDetailDeps, 'findRestaurantNames' | 'findUserEmail'> = defaultDeps
): Promise<EnrichedTemplateReview[]> {
  if (reviews.length === 0) return []
  const submitters = distinct(reviews.map((r) => r.submittedBy)).filter(isUuid)
  const [names, emails] = await Promise.all([
    deps.findRestaurantNames(distinct(reviews.map((r) => r.restaurantId))),
    Promise.all(submitters.map(async (id) => [id, await deps.findUserEmail(id)] as const)),
  ])
  const emailById = new Map(emails)
  return reviews.map((r) => ({
    ...r,
    restaurantName: names.get(r.restaurantId) ?? null,
    submitterEmail: emailById.get(r.submittedBy) ?? null,
  }))
}

async function resolveTemplate(
  review: TemplateReviewProps,
  deps: TemplateReviewDetailDeps
): Promise<WhatsAppTemplate | null> {
  if (review.templateId) {
    const byId = await deps.findTemplateById(review.templateId, review.restaurantId)
    if (byId) return byId
  }
  return deps.findLatestTemplateByName(review.restaurantId, review.templateName)
}

async function loadCampaigns(
  restaurantId: string,
  templateId: string,
  deps: TemplateReviewDetailDeps
): Promise<TemplateReviewDetailCampaign[]> {
  const rows = await deps.listCampaignsUsingTemplate(restaurantId, templateId)
  return Promise.all(
    rows.map(async (c) => ({ ...c, audienceSize: await sizeAudience(c, restaurantId, deps) }))
  )
}

// A failed count must not take the whole review panel down — the admin can
// still judge the template; the size reads as unknown.
async function sizeAudience(
  c: TemplateCampaignRow,
  restaurantId: string,
  deps: TemplateReviewDetailDeps
): Promise<number | null> {
  try {
    if (c.targetAudience === 'selected') return await deps.countCampaignMembers(c.id)
    if (c.targetAudience !== 'tag') return null
    const tagIds = await deps.getCampaignTagIds(c.id)
    return await deps.countActiveMembersByTags(tagIds, restaurantId)
  } catch (err) {
    console.warn(`getTemplateReviewDetail: audience size for campaign ${c.id} failed:`, err)
    return null
  }
}

function pickTemplate(t: WhatsAppTemplate): TemplateReviewDetailTemplate {
  return {
    id: t.id,
    name: t.name,
    language: t.language,
    category: t.category,
    status: t.status,
    components: t.components,
  }
}

function distinct(values: string[]): string[] {
  return Array.from(new Set(values))
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Legacy rows carry submittedBy 'unknown' (template-review-mapper) — not a user.
function isUuid(value: string): boolean {
  return UUID_REGEX.test(value)
}
