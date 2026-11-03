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
import { findRestaurantNamesByIds, listUserEmailsById } from '@/infrastructure/supabase/repositories/admin-identity-lookups'
import { isValidUUID } from '@/infrastructure/validation/validators'
import {
  findLatestTemplateByNameForRestaurant,
  listCampaignsUsingTemplate,
  countCampaignMembers,
  type TemplateCampaignRow,
} from '@/infrastructure/supabase/repositories/template-review-detail-queries'

export interface TemplateReviewDetailDeps {
  findReviewById(id: string): Promise<TemplateReview | null>
  findRestaurantNames(ids: string[]): Promise<Map<string, string>>
  /** Every auth user's email by id — ONE call per request, not per row. */
  findUserEmails(): Promise<Map<string, string>>
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
  findUserEmails: listUserEmailsById,
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
  /** true when no template record could be resolved — the UI shows a notice, never a guess. */
  templateMissing: boolean
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
    templateMissing: template === null,
    campaigns,
  }
}

/** One restaurant query and one user listing for the whole list — no per-row calls. */
export async function enrichTemplateReviews(
  reviews: TemplateReviewProps[],
  deps: Pick<TemplateReviewDetailDeps, 'findRestaurantNames' | 'findUserEmails'> = defaultDeps
): Promise<EnrichedTemplateReview[]> {
  if (reviews.length === 0) return []
  // Legacy rows carry submittedBy 'unknown' (template-review-mapper) — not a user.
  const hasUserSubmitter = reviews.some((r) => isValidUUID(r.submittedBy))
  const [names, emails] = await Promise.all([
    deps.findRestaurantNames(distinct(reviews.map((r) => r.restaurantId))),
    hasUserSubmitter ? deps.findUserEmails() : Promise.resolve(new Map<string, string>()),
  ])
  return reviews.map((r) => ({
    ...r,
    restaurantName: names.get(r.restaurantId) ?? null,
    submitterEmail: emails.get(r.submittedBy) ?? null,
  }))
}

// The admin must judge what was submitted: a review that names a template id
// resolves ONLY that id — a missing row is reported, never swapped for another
// template of the same name (findTemplateById swallows errors, so a null may
// also be a failed read; either way nothing else is shown). The name fallback
// is for id-less reviews only; the review row carries no language
// (template_review_queue has none), so it is latest-by-name.
async function resolveTemplate(
  review: TemplateReviewProps,
  deps: TemplateReviewDetailDeps
): Promise<WhatsAppTemplate | null> {
  if (review.templateId) return deps.findTemplateById(review.templateId, review.restaurantId)
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
