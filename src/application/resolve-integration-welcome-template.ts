// INT-001 WI-4 (T-M11): send-time template resolution for the welcome job.
// `send_welcome` / `new_join_template_id` are ceilings, not requests -- a
// template id can outlive its ownership (set via the API before a
// transfer), so this rule is re-run fresh at SEND time, independently of
// WI-3's create-time inline resolution (`process-member-create-job.ts`'s
// own `resolveWelcomeTemplate` helper -- that copy stays create-time-only
// by design; a rename between create and send must be re-evaluated, not
// trusted from the earlier call).
//
// `'default'` -> onboarding `welcomeCampaignId` -> campaign
// `whatsappTemplateId` -> `findByIdForRestaurant`; a uuid ->
// `findByIdForRestaurant` directly. Every miss (no mapping, foreign
// template, not approved) collapses to `{ found: false }` --
// `decideWelcome` (reused by `process-welcome-send-job.ts`) treats them all
// as `skipped_no_template`.

import type { Campaign } from '@/domain/entities/campaign'
import type { WhatsAppTemplate } from '@/domain/entities/whatsapp-template'
import { isTemplateSendable } from '@/domain/entities/whatsapp-template'
import { getCampaignByIdForRestaurant } from '@/infrastructure/supabase/repositories/campaign-repository'
import { getOnboardingSettings } from '@/infrastructure/supabase/repositories/restaurant-onboarding-repository'
import { findByIdForRestaurant as findTemplateByIdForRestaurant } from '@/infrastructure/supabase/repositories/whatsapp-template-repository'

export type WelcomeTemplateResolution =
  | { found: false }
  | { found: true; template: WhatsAppTemplate; campaign: Campaign | null }

export async function resolveIntegrationWelcomeTemplate(
  newJoinTemplateId: string,
  restaurantId: string
): Promise<WelcomeTemplateResolution> {
  if (newJoinTemplateId === 'default') {
    const settings = await getOnboardingSettings(restaurantId).catch(() => null)
    if (!settings?.welcomeCampaignId) return { found: false }

    const campaign = await getCampaignByIdForRestaurant(settings.welcomeCampaignId, restaurantId).catch(() => null)
    if (!campaign?.whatsappTemplateId) return { found: false }

    const template = await findTemplateByIdForRestaurant(campaign.whatsappTemplateId, restaurantId)
    if (!template || !isTemplateSendable(template)) return { found: false }
    return { found: true, template, campaign }
  }

  const template = await findTemplateByIdForRestaurant(newJoinTemplateId, restaurantId)
  if (!template || !isTemplateSendable(template)) return { found: false }
  return { found: true, template, campaign: null }
}
