// Shared WhatsApp-template resolution (issue #102 fix 2).
//
// Both the campaign-queue worker (execute-campaign.ts) and the synchronous
// send-time gate in POST /api/dashboard/campaigns/[id]/execute need the
// exact same "does this campaign have a sendable template" resolution — the
// route pre-checks WAQ-011 with the SAME template the worker would use, so
// the pre-check and the actual send can't drift apart.

import { findTemplateByIdForRestaurant } from '@/infrastructure/supabase/repositories/whatsapp-template-repository'
import { isTemplateSendable, WhatsAppTemplate } from '@/domain/entities/whatsapp-template'
import { Campaign } from '@/domain/entities/campaign'

// Typed so the synchronous execute route (#102 item 3) can map each case to
// the right HTTP status with the real message, instead of falling through
// to a generic 500 — a user-caused state (misconfigured campaign) must
// explain itself. Also tenant-meaningful for the queue worker's terminal
// failure_reason (item 8): these are safe to store/display verbatim.
export class WhatsAppTemplateNotFoundError extends Error {
  constructor(templateId: string) {
    super(`WhatsApp template ${templateId} not found`)
    this.name = 'WhatsAppTemplateNotFoundError'
  }
}

export class WhatsAppTemplateNotApprovedError extends Error {
  constructor(templateName: string) {
    super(`WhatsApp template ${templateName} is not approved`)
    this.name = 'WhatsAppTemplateNotApprovedError'
  }
}

export async function resolveWhatsAppTemplate(
  campaign: Campaign
): Promise<WhatsAppTemplate | null> {
  if (!campaign.whatsappTemplateId) return null
  // Scoped-query tenant isolation (SEC-001 pattern, #127 review): campaign
  // rows accept whatsappTemplateId without an ownership check, so the id's
  // provenance is NOT tenant-scoped — and the send path now forwards the
  // resolved row's stored header URL as member-visible media. A foreign id
  // must resolve like a missing one.
  const template = await findTemplateByIdForRestaurant(
    campaign.whatsappTemplateId,
    campaign.restaurantId
  )
  if (!template) {
    throw new WhatsAppTemplateNotFoundError(campaign.whatsappTemplateId)
  }
  if (!isTemplateSendable(template)) {
    throw new WhatsAppTemplateNotApprovedError(template.name)
  }
  return template
}
