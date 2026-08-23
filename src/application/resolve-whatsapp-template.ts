// Shared WhatsApp-template resolution (issue #102 fix 2).
//
// Both the campaign-queue worker (execute-campaign.ts) and the synchronous
// send-time gate in POST /api/dashboard/campaigns/[id]/execute need the
// exact same "does this campaign have a sendable template" resolution — the
// route pre-checks WAQ-011 with the SAME template the worker would use, so
// the pre-check and the actual send can't drift apart.

import { findTemplateById } from '@/infrastructure/supabase/repositories/whatsapp-template-repository'
import { isTemplateSendable, WhatsAppTemplate } from '@/domain/entities/whatsapp-template'
import { Campaign } from '@/domain/entities/campaign'

export async function resolveWhatsAppTemplate(
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
