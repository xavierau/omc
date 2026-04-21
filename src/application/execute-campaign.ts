import {
  getCampaignById,
  updateCampaign,
  transitionCampaignStatus,
} from '@/infrastructure/supabase/repositories/campaign-repository'
import { getRestaurantPhoneNumberId } from '@/infrastructure/supabase/repositories/restaurant-repository'
import { getRestaurantDefaultLanguage } from '@/infrastructure/supabase/repositories/restaurant-onboarding-repository'
import { findTemplateById } from '@/infrastructure/supabase/repositories/whatsapp-template-repository'
import { isTemplateSendable, WhatsAppTemplate } from '@/domain/entities/whatsapp-template'
import { Campaign } from '@/domain/entities/campaign'
import { Language } from '@/domain/value-objects/language'
import { resolveTargetMembers } from './resolve-campaign-members'
import { resolveCampaignTemplate } from './resolve-campaign-template'
import { checkCampaignGuardrails } from './check-campaign-guardrails'
import { CampaignGuardrailError } from './campaign-guardrail-error'
import { sendInBatches, type SendContext } from './execute-campaign-batch'

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

  const claimed = await transitionCampaignStatus(campaignId, 'active', 'sending')
  if (!claimed) throw new Error(`Campaign ${campaignId} not active or already processing`)

  try {
    const ctx = await buildSendContext(campaign, restaurantId)
    await sendInBatches(activeMembers, ctx)
    await updateCampaign(campaignId, { status: 'completed' })
  } catch (err) {
    await updateCampaign(campaignId, { status: 'active' })
    throw err
  }
}

async function buildSendContext(
  campaign: Campaign,
  restaurantId: string
): Promise<SendContext> {
  const phoneNumberId = await getRestaurantPhoneNumberId(restaurantId)
  const template = await resolveWhatsAppTemplate(campaign)
  const languageCode = await getRestaurantDefaultLanguage(restaurantId)
  const language = Language.fromCodeOrDefault(languageCode, Language.default())
  const resolvedTemplate = resolveCampaignTemplate(campaign, language)
  if (!template && resolvedTemplate === null) {
    throw new NoTemplateError(campaign.id)
  }
  return { campaign, phoneNumberId, template, language, resolvedTemplate }
}

async function resolveWhatsAppTemplate(
  campaign: Campaign
): Promise<WhatsAppTemplate | null> {
  if (!campaign.whatsappTemplateId) return null
  const template = await findTemplateById(campaign.whatsappTemplateId)
  if (!template) {
    throw new Error(`WhatsApp template ${campaign.whatsappTemplateId} not found`)
  }
  if (!isTemplateSendable(template)) {
    throw new Error(`WhatsApp template ${template.name} is not approved`)
  }
  return template
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
