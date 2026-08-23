import {
  getCampaignById,
  updateCampaign,
  transitionCampaignStatus,
} from '@/infrastructure/supabase/repositories/campaign-repository'
import { getRestaurantPhoneNumberId } from '@/infrastructure/supabase/repositories/restaurant-repository'
import { getRestaurantDefaultLanguage } from '@/infrastructure/supabase/repositories/restaurant-onboarding-repository'
import { WhatsAppTemplate } from '@/domain/entities/whatsapp-template'
import { Campaign } from '@/domain/entities/campaign'
import { Language } from '@/domain/value-objects/language'
import { resolveTargetMembers } from './resolve-campaign-members'
import { resolveCampaignTemplate } from './resolve-campaign-template'
import { resolveWhatsAppTemplate } from './resolve-whatsapp-template'
import { checkCampaignGuardrails } from './check-campaign-guardrails'
import { enforceTemplateReview } from './enforce-template-review'
import { CampaignGuardrailError } from './campaign-guardrail-error'
import { sendInBatches, type SendContext } from './execute-campaign-batch'
import { getSettingsForTenant } from '@/infrastructure/supabase/repositories/campaign-settings-repository'
import {
  DEFAULT_PER_USER_MARKETING_CAP,
  type TenantCampaignSettings,
} from '@/domain/services/campaign-guardrails'
import {
  DEFAULT_PACING_CONFIG,
  type PacingConfig,
} from '@/domain/value-objects/pacing-strategy'

export class NoTemplateError extends Error {
  constructor(campaignId: string) {
    super(`Campaign ${campaignId} has no template in any language`)
    this.name = 'NoTemplateError'
  }
}

export async function executeCampaign(
  campaignId: string,
  restaurantId: string
): Promise<void> {
  const campaign = await getCampaignById(campaignId)
  if (!campaign) throw new Error(`Campaign ${campaignId} not found`)
  if (campaign.type === 'welcome') {
    throw new Error('Welcome campaigns are triggered on member join')
  }

  const members = await resolveTargetMembers(campaign, restaurantId)
  const activeMembers = members.filter((m) => m.status !== 'unsubscribed')
  await enforceGuardrails(restaurantId, activeMembers.length)

  // Resolve template up-front so we fail fast (status unchanged) on a
  // misconfigured campaign — no state churn, no revert required.
  const template = await resolveWhatsAppTemplate(campaign)
  assertHasAnyInlineTemplate(campaign, template)
  // WAQ-011: untrusted tenants need an approved review row for MARKETING.
  await enforceTemplateReview({ campaign, restaurantId, template })

  const claimed = await transitionCampaignStatus(campaignId, 'active', 'sending')
  if (!claimed) throw new Error(`Campaign ${campaignId} not active or already processing`)

  try {
    const ctx = await buildSendContext(campaign, restaurantId, template)
    await sendInBatches(activeMembers, ctx)
    await updateCampaign(campaignId, { status: 'completed' })
  } catch (err) {
    await updateCampaign(campaignId, { status: 'active' })
    throw err
  }
}

async function buildSendContext(
  campaign: Campaign,
  restaurantId: string,
  template: WhatsAppTemplate | null
): Promise<SendContext> {
  const phoneNumberId = await getRestaurantPhoneNumberId(restaurantId)
  const restaurantDefaultLanguage = await getRestaurantDefaultLanguage(
    restaurantId
  )
  // Capture the tracking flag ONCE per campaign run so an env-flip
  // mid-batch doesn't orphan in-flight queued rows.
  const trackingEnabled = process.env.WAQ_TRACK_MESSAGES === '1'
  // Same pattern for WAQ-007 cooldown cap + WAQ-010 pacing — read once.
  const settings = await getSettingsForTenant(restaurantId)
  const perUserMarketingCap =
    settings?.perUserMarketingCap ?? DEFAULT_PER_USER_MARKETING_CAP
  return {
    campaign,
    phoneNumberId,
    template,
    restaurantDefaultLanguage,
    trackingEnabled,
    perUserMarketingCap,
    pacingConfig: pacingConfigFrom(settings),
  }
}

// WAQ-010: snapshot pacing so a mid-batch tenant-settings update can't
// re-chunk an in-flight run. `settings` is null only on a missing row.
function pacingConfigFrom(
  settings: TenantCampaignSettings | null
): PacingConfig {
  if (!settings) return DEFAULT_PACING_CONFIG
  return {
    strategy: settings.pacingStrategy,
    probeChunkSize: settings.probeChunkSize,
    scaleChunkSize: settings.scaleChunkSize,
    activeHoursStartLocal: settings.activeHoursStartLocal,
    activeHoursEndLocal: settings.activeHoursEndLocal,
    tenantTimezone: settings.tenantTimezone,
  }
}

function assertHasAnyInlineTemplate(
  campaign: Campaign,
  template: WhatsAppTemplate | null
): void {
  if (template) return
  const hasEn = resolveCampaignTemplate(campaign, Language.EN) !== null
  const hasZh = resolveCampaignTemplate(campaign, Language.ZH_HK) !== null
  if (!hasEn && !hasZh) throw new NoTemplateError(campaign.id)
}

async function enforceGuardrails(
  restaurantId: string,
  memberCount: number
): Promise<void> {
  const result = await checkCampaignGuardrails(restaurantId, memberCount)
  if (!result.allowed) {
    throw new CampaignGuardrailError(result.violations)
  }
  if (result.warnings.length > 0) {
    console.warn('[Campaign] Guardrail warnings:', result.warnings)
  }
}

export { CampaignGuardrailError } from './campaign-guardrail-error'
