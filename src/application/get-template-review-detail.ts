// WAQ-011-DETAIL: everything a platform admin needs to judge a template
// review — the full template and every campaign that sends it (the list row
// already carries the readable restaurant name and submitter email; the list
// route enriches it via enrichTemplateReviews below). Read-only. Callers (admin routes) MUST have run
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

export interface ReviewEnrichmentDeps {
  findRestaurantNames(ids: string[]): Promise<Map<string, string>>
  /** Every auth user's email by id — ONE call per request, not per row. */
  findUserEmails(): Promise<Map<string, string>>
}

export interface TemplateReviewDetailDeps {
  findReviewById(id: string): Promise<TemplateReview | null>
  findTemplateById(id: string, restaurantId: string): Promise<WhatsAppTemplate | null>
  findLatestTemplateByName(restaurantId: string, name: string): Promise<WhatsAppTemplate | null>
  listCampaignsUsingTemplate(restaurantId: string, templateId: string): Promise<TemplateCampaignRow[]>
  getCampaignTagIds(campaignId: string): Promise<string[]>
  countActiveMembersByTags(tagIds: string[], restaurantId: string): Promise<number>
  countCampaignMembers(campaignId: string): Promise<number>
}

const enrichmentDeps: ReviewEnrichmentDeps = {
  findRestaurantNames: findRestaurantNamesByIds,
  findUserEmails: listUserEmailsById,
}

const defaultDeps: TemplateReviewDetailDeps = {
  findReviewById: findTemplateReviewById,
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
  /**
   * null = no template record could be loaded (deleted, or the lookup failed —
   * findTemplateById cannot tell them apart). The UI shows a notice, never a guess.
   */
  template: TemplateReviewDetailTemplate | null
  /**
   * Listed by the review's templateId whenever it has one, even when the
   * template row did not resolve. null = unknown: an id-less review whose name
   * lookup found nothing, or a failed lookup/listing (campaignsError).
   */
  campaigns: TemplateReviewDetailCampaign[] | null
  /** true when a lookup threw — the panel says so instead of claiming "no campaigns". */
  campaignsError: boolean
}

type ResolvedTemplate = { template: WhatsAppTemplate | null; failed: boolean }
type CampaignsResult = Pick<TemplateReviewDetail, 'campaigns' | 'campaignsError'>

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
  const resolved = await resolveTemplate(review, deps)
  // Campaigns still wired to the review's template must show even when that
  // row is gone (soft-deleted) or its lookup failed: list by the id itself.
  const listBy = review.templateId ?? resolved.template?.id ?? null
  const campaigns: CampaignsResult = listBy
    ? await campaignsFor(review.restaurantId, listBy, deps)
    : { campaigns: null, campaignsError: resolved.failed }
  return {
    review,
    template: resolved.template ? pickTemplate(resolved.template) : null,
    ...campaigns,
  }
}

/** One restaurant query and one user listing for the whole list — no per-row calls. */
export async function enrichTemplateReviews(
  reviews: TemplateReviewProps[],
  deps: ReviewEnrichmentDeps = enrichmentDeps
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
// (template_review_queue has none), so it is latest-by-name. A lookup that
// throws degrades to "could not be loaded" instead of failing the panel.
async function resolveTemplate(
  review: TemplateReviewProps,
  deps: TemplateReviewDetailDeps
): Promise<ResolvedTemplate> {
  try {
    const template = review.templateId
      ? await deps.findTemplateById(review.templateId, review.restaurantId)
      : await deps.findLatestTemplateByName(review.restaurantId, review.templateName)
    return { template, failed: false }
  } catch (err) {
    console.warn(`getTemplateReviewDetail: template lookup for review ${review.id} failed:`, err)
    return { template: null, failed: true }
  }
}

async function campaignsFor(
  restaurantId: string,
  templateId: string,
  deps: TemplateReviewDetailDeps
): Promise<CampaignsResult> {
  try {
    return { campaigns: await loadCampaigns(restaurantId, templateId, deps), campaignsError: false }
  } catch (err) {
    console.warn(`getTemplateReviewDetail: campaigns for template ${templateId} failed:`, err)
    return { campaigns: null, campaignsError: true }
  }
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
