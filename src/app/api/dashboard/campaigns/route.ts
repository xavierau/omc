import { NextRequest, NextResponse } from 'next/server'
import {
  listCampaigns,
  createCampaign,
  setCampaignMembers,
  remapWelcomeCampaign,
} from '@/infrastructure/supabase/repositories/campaign-repository'
import {
  getOnboardingSettings,
  getRestaurantDefaultLanguage,
} from '@/infrastructure/supabase/repositories/restaurant-onboarding-repository'
import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { assertTagsBelongToTenant } from '@/infrastructure/supabase/repositories/member-tag-repository'
import { setCampaignTags } from '@/application/set-campaign-tags'
import { parseCreateBody } from './parse-create-body'
import { handleError } from './campaign-error-response'
import { withTemplateReview, safeCampaignTemplateReviewStates } from './with-template-review'
import type { LanguageCode } from '@/domain/value-objects/language'
import type { Campaign } from '@/domain/entities/campaign'

export async function GET() {
  try {
    const { restaurantId } = await getTenantContext()
    const campaigns = await listCampaigns(restaurantId)
    // Issue #102 fix 4: let the UI explain a disabled Send button instead
    // of failing silently. Degrades OFF on enrichment failure (item 2).
    const reviewStates = await safeCampaignTemplateReviewStates(restaurantId, campaigns)
    return NextResponse.json({
      campaigns: campaigns.map((c) => withTemplateReview(c, reviewStates)),
    })
  } catch (error) {
    return handleError(error, 'Campaigns API error', 'Failed to load campaigns')
  }
}

export async function POST(request: NextRequest) {
  try {
    const { restaurantId } = await getTenantContext()
    const body = (await request.json()) as Record<string, unknown>
    const parsed = parseCreateBody(body, restaurantId)
    // Ownership is asserted BEFORE the insert: setCampaignTags would reject a
    // foreign or deleted tag id only after the campaign row exists, leaving a
    // 'tag' campaign with zero links — an audience that silently resolves to
    // nobody and cannot be fixed from the form (review round 2, finding 4).
    if (parsed.targetAudience === 'tag') {
      await assertTagsBelongToTenant(parsed.tagIds, restaurantId)
    }
    const defaultLang = await getRestaurantDefaultLanguage(restaurantId)
    const legacyTemplate = resolveLegacyTemplate(parsed, defaultLang)

    const campaign = await createCampaign({
      restaurantId,
      name: parsed.name,
      type: parsed.type,
      legacyTemplate,
      templateEn: parsed.templateEn,
      templateZhHk: parsed.templateZhHk,
      imageUrlEn: parsed.imageUrlEn,
      imageUrlZhHk: parsed.imageUrlZhHk,
      whatsappTemplateId: parsed.whatsappTemplateId,
      couponConfig:
        parsed.couponConfig as unknown as Parameters<
          typeof createCampaign
        >[0]['couponConfig'],
      scheduledAt: parsed.scheduledAt,
      schedule: parsed.schedule,
      status: parsed.status,
      targetAudience: parsed.targetAudience,
    })

    if (parsed.targetAudience === 'selected') {
      await setCampaignMembers(campaign.id, parsed.memberIds, restaurantId)
    }

    if (parsed.targetAudience === 'tag') {
      await setCampaignTags(campaign.id, parsed.tagIds, restaurantId)
    }

    if (campaign.type === 'welcome') {
      await tryAutoMapWelcome(restaurantId, campaign)
    }

    return NextResponse.json(campaign, { status: 201 })
  } catch (error) {
    return handleError(error, 'Campaign create API error', 'Failed to create campaign')
  }
}

/**
 * Best-effort: creating a type='welcome' campaign signals admin intent to
 * make it THE welcome campaign. Route through remapWelcomeCampaign so the
 * atomic RPC flips is_chargeable=false (welcome sends must never bill).
 * A failure here logs but does not block the 201 response — the admin can
 * retry via the onboarding picker.
 */
async function tryAutoMapWelcome(
  restaurantId: string,
  campaign: Campaign
): Promise<void> {
  try {
    const settings = await getOnboardingSettings(restaurantId)
    await remapWelcomeCampaign(
      restaurantId,
      settings.welcomeCampaignId,
      campaign.id
    )
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    console.warn(
      `Campaign create: auto-map welcome failed for restaurant ${restaurantId}, campaign ${campaign.id}: ${reason}`
    )
  }
}

function normalize(value: string | null | undefined): string | null {
  return value && value.trim() !== '' ? value : null
}

/**
 * Compute the legacy `template` column value for CREATE. Mirrors the PATCH
 * derivation so rolling-deploy readers don't see the wrong language or an
 * empty string when the admin only filled one language.
 */
function resolveLegacyTemplate(
  parsed: { template: string; templateEn: string | null; templateZhHk: string | null },
  defaultLang: LanguageCode
): string {
  const explicit = normalize(parsed.template)
  const en = normalize(parsed.templateEn)
  const zhHk = normalize(parsed.templateZhHk)
  const derived =
    defaultLang === 'en' ? (en ?? zhHk) : (zhHk ?? en)
  return explicit ?? derived ?? ''
}
