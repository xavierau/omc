// WONB-008 helpers extracted from execute-reconfirmation-campaign.ts to
// keep the orchestrator under the file-size limit.

import { getRestaurantPhoneNumberId } from '@/infrastructure/supabase/repositories/restaurant-repository'
import { getRestaurantDefaultLanguage } from '@/infrastructure/supabase/repositories/restaurant-onboarding-repository'
import { findTemplateById } from '@/infrastructure/supabase/repositories/whatsapp-template-repository'
import { getSettingsForTenant } from '@/infrastructure/supabase/repositories/campaign-settings-repository'
import {
  isTemplateSendable,
  type WhatsAppTemplate,
} from '@/domain/entities/whatsapp-template'
import {
  DEFAULT_PER_USER_MARKETING_CAP,
  type TenantCampaignSettings,
} from '@/domain/services/campaign-guardrails'
import {
  DEFAULT_PACING_CONFIG,
  type PacingConfig,
} from '@/domain/value-objects/pacing-strategy'
import { ReconfirmationTemplateError } from '@/domain/services/__errors__/reconfirmation-errors'
import type { SendContext } from './execute-campaign-batch'
import type { Campaign } from '@/domain/entities/campaign'
import type { Member } from '@/domain/entities/member'
import type { ReconfirmationAudienceRow } from '@/infrastructure/supabase/repositories/consent-record-repository'

// Loads + validates the UTILITY-category template attached to the campaign.
// Throws typed ReconfirmationTemplateError so the route layer can surface a
// machine-readable reason ('not_utility' vs 'not_approved').
export async function loadUtilityTemplate(
  campaign: Campaign
): Promise<WhatsAppTemplate> {
  if (!campaign.whatsappTemplateId) {
    throw new ReconfirmationTemplateError('not_utility')
  }
  const template = await findTemplateById(campaign.whatsappTemplateId)
  if (!template) throw new ReconfirmationTemplateError('not_utility')
  if (template.category !== 'UTILITY') {
    throw new ReconfirmationTemplateError('not_utility')
  }
  if (!isTemplateSendable(template)) {
    throw new ReconfirmationTemplateError('not_approved')
  }
  return template
}

interface BuildCtxInput {
  campaign: Campaign
  restaurantId: string
  template: WhatsAppTemplate
}

export async function buildReconfirmationSendContext(
  input: BuildCtxInput
): Promise<SendContext> {
  const phoneNumberId = await getRestaurantPhoneNumberId(input.restaurantId)
  const restaurantDefaultLanguage = await getRestaurantDefaultLanguage(
    input.restaurantId
  )
  const settings = await getSettingsForTenant(input.restaurantId)
  return {
    campaign: input.campaign,
    phoneNumberId,
    template: input.template,
    restaurantDefaultLanguage,
    trackingEnabled: process.env.WAQ_TRACK_MESSAGES === '1',
    perUserMarketingCap:
      settings?.perUserMarketingCap ?? DEFAULT_PER_USER_MARKETING_CAP,
    pacingConfig: pacingConfigFrom(settings),
  }
}

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

export function audienceToMembers(
  rows: ReconfirmationAudienceRow[],
  restaurantId: string
): Member[] {
  return rows.map((r) => ({
    id: r.memberId,
    restaurantId,
    phone: r.phoneE164,
    name: null,
    pointsBalance: 0,
    status: 'active',
    joinedAt: '',
    lastVisitAt: null,
    preferredLanguage: r.preferredLanguage,
    pmmThrottledUntil: null,
    unreachableAt: null,
  }))
}
