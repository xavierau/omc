import { NextRequest, NextResponse } from 'next/server'
import {
  listCampaigns,
  createCampaign,
  setCampaignMembers,
  remapWelcomeCampaign,
  CrossTenantMemberError,
  CampaignUniqueViolationError,
} from '@/infrastructure/supabase/repositories/campaign-repository'
import {
  getOnboardingSettings,
  getRestaurantDefaultLanguage,
} from '@/infrastructure/supabase/repositories/restaurant-onboarding-repository'
import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'
import { parseCreateBody, CampaignBodyError } from './parse-create-body'
import {
  buildCampaignTemplateReviewStates,
  type CampaignTemplateReviewState,
} from '@/application/build-campaign-template-review-states'
import { withTemplateReview } from './with-template-review'
import type { LanguageCode } from '@/domain/value-objects/language'
import type { Campaign } from '@/domain/entities/campaign'

export async function GET() {
  try {
    const { restaurantId } = await getTenantContext()
    const campaigns = await listCampaigns(restaurantId)
    // Issue #102 fix 4: let the UI explain a disabled Send button instead
    // of failing silently.
    const reviewStates = await safeCampaignTemplateReviewStates(restaurantId, campaigns)
    return NextResponse.json({
      campaigns: campaigns.map((c) => withTemplateReview(c, reviewStates)),
    })
  } catch (error) {
    return handleError(error, 'Campaigns API error', 'Failed to load campaigns')
  }
}

/**
 * Degrade OFF (review round 2, item 9 — REPLY-001 precedent): the
 * Send-button explanation is a nice-to-have layered on top of the
 * campaigns list. If the enrichment subsystem (trust check / template
 * lookup / review-queue lookup) errors, the list itself must still load —
 * campaigns just come back without `templateReview` rather than a 500.
 */
async function safeCampaignTemplateReviewStates(
  restaurantId: string,
  campaigns: Campaign[]
): Promise<Map<string, CampaignTemplateReviewState>> {
  try {
    return await buildCampaignTemplateReviewStates(restaurantId, campaigns)
  } catch (error) {
    console.error('Campaign template-review enrichment failed (degrading OFF):', error)
    return new Map()
  }
}

export async function POST(request: NextRequest) {
  try {
    const { restaurantId } = await getTenantContext()
    const body = (await request.json()) as Record<string, unknown>
    const parsed = parseCreateBody(body, restaurantId)
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

function handleError(error: unknown, logLabel: string, defaultMsg: string) {
  if (error instanceof AuthError) {
    return NextResponse.json(
      { error: error.message },
      { status: error.statusCode }
    )
  }
  if (error instanceof CampaignBodyError) {
    return NextResponse.json({ error: error.message }, { status: error.statusCode })
  }
  if (error instanceof CrossTenantMemberError) {
    return NextResponse.json({ error: error.message }, { status: error.statusCode })
  }
  if (
    error instanceof CampaignUniqueViolationError &&
    error.constraint === 'idx_campaigns_one_active_welcome_per_restaurant'
  ) {
    return NextResponse.json(
      {
        error:
          'An active welcome campaign already exists for this restaurant. Edit it instead of creating a new one.',
      },
      { status: 409 }
    )
  }
  console.error(`${logLabel}:`, error)
  return NextResponse.json({ error: defaultMsg }, { status: 500 })
}
