// Issue #102 fix 4: per-campaign template-review state for the dashboard
// campaigns API, so the UI can explain a disabled Send button instead of
// failing silently (today `checkCampaignGuardrails` never consults the
// WAQ-011 gate, so the Send button stays enabled with no explanation).
//
// N+1 ZERO TOLERANCE: one `isTenantTrusted` call (restaurant-scoped, not
// per campaign), one batch template fetch, one batch review-queue fetch —
// regardless of how many campaigns are in the list.

import type { Campaign } from '@/domain/entities/campaign'
import type { WhatsAppTemplate } from '@/domain/entities/whatsapp-template'
import type { ReviewStatus } from '@/domain/value-objects/review-status'
import { isTenantTrusted } from './check-tenant-trust'
import { findManyByIdsForRestaurant } from '@/infrastructure/supabase/repositories/whatsapp-template-repository'
import { findLatestTemplateReviewsByNames } from '@/infrastructure/supabase/repositories/template-review-repository'

export interface CampaignTemplateReviewState {
  required: boolean
  status: 'none' | ReviewStatus
}

export async function buildCampaignTemplateReviewStates(
  restaurantId: string,
  campaigns: Campaign[]
): Promise<Map<string, CampaignTemplateReviewState>> {
  const templateIds = distinctTemplateIds(campaigns)
  if (templateIds.length === 0) return new Map()

  const templates = await findManyByIdsForRestaurant(templateIds, restaurantId)
  const marketingNames = distinctMarketingNames(templates)
  if (marketingNames.length === 0) return new Map()

  const [trust, reviews] = await Promise.all([
    isTenantTrusted({ restaurantId }),
    findLatestTemplateReviewsByNames({ restaurantId, templateNames: marketingNames }),
  ])

  return statesByCampaign(campaigns, templates, trust.trusted, reviews)
}

function distinctTemplateIds(campaigns: Campaign[]): string[] {
  const ids = campaigns
    .map((c) => c.whatsappTemplateId)
    .filter((id): id is string => !!id)
  return Array.from(new Set(ids))
}

function distinctMarketingNames(templates: WhatsAppTemplate[]): string[] {
  const names = templates
    .filter((t) => t.category === 'MARKETING')
    .map((t) => t.name)
  return Array.from(new Set(names))
}

function statesByCampaign(
  campaigns: Campaign[],
  templates: WhatsAppTemplate[],
  trusted: boolean,
  reviews: Array<{ snapshot: { templateName: string; status: ReviewStatus } }>
): Map<string, CampaignTemplateReviewState> {
  const templateById = new Map(templates.map((t) => [t.id, t]))
  const statusByName = new Map(
    reviews.map((r) => [r.snapshot.templateName, r.snapshot.status])
  )

  const states = new Map<string, CampaignTemplateReviewState>()
  for (const campaign of campaigns) {
    const template = campaign.whatsappTemplateId
      ? templateById.get(campaign.whatsappTemplateId)
      : undefined
    if (!template || template.category !== 'MARKETING') continue
    states.set(campaign.id, {
      required: !trusted,
      status: statusByName.get(template.name) ?? 'none',
    })
  }
  return states
}
