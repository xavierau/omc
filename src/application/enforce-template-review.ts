// WAQ-011: send-time enforcement wrapper around `checkTemplateReview`.
//
// Thin glue: gate the marketing send by an approved review row when the
// tenant isn't trusted. UTILITY templates and inline-only campaigns skip
// — the queue exists to police bulk marketing only. Lives in its own
// file (rather than inside `execute-campaign.ts`) so the dependency
// surface of the executor stays small enough to keep the file under the
// 150-line cap.
//
// WAQ-014: the wrapper now renders `checkTemplateReview`'s `trustReason`
// into the thrown message — that module's header already promised a
// diagnosable reason, but this wrapper was discarding it and throwing a
// generic "platform approval" string that reads as Meta/WhatsApp approval.

import type { Campaign } from '@/domain/entities/campaign'
import type { WhatsAppTemplate } from '@/domain/entities/whatsapp-template'
import { CampaignGuardrailError } from './campaign-guardrail-error'
import {
  checkTemplateReview,
  type TemplateReviewCheckResult,
} from './check-template-review'

export interface EnforceTemplateReviewArgs {
  campaign: Campaign
  restaurantId: string
  template: WhatsAppTemplate | null
}

type ReasonKey = NonNullable<TemplateReviewCheckResult['trustReason']>

// Record<ReasonKey, string> (not Partial/index signature) so a future 4th
// TrustReason is a compile error here, not a silently-generic message.
const CAUSE_BY_REASON: Record<ReasonKey, string> = {
  too_new: 'this account is less than 90 days old',
  recent_quality_incident:
    'a WhatsApp quality-rating incident in the last 90 days',
  auto_paused: 'campaigns are currently auto-paused by the quality monitor',
}
const UNSPECIFIED_CAUSE =
  'this account is not yet trusted for unreviewed marketing'

// Keeps buildBlockedMessage within FAILURE_REASON_MAX_LEN for any template
// name (56 chars + ellipsis = 57 max). Control chars are stripped first —
// the name is tenant-supplied and failure_reason is rendered verbatim, so a
// newline must not be able to forge extra message lines.
const NAME_CLAMP_LEN = 56

function clampName(name: string): string {
  const clean = name.replace(/[\u0000-\u001f\u007f]/g, ' ')
  return clean.length <= NAME_CLAMP_LEN ? clean : `${clean.slice(0, NAME_CLAMP_LEN)}…`
}

function buildBlockedMessage(
  template: WhatsAppTemplate, campaign: Campaign,
  trustReason: TemplateReviewCheckResult['trustReason']
): string {
  const cause = trustReason ? CAUSE_BY_REASON[trustReason] : UNSPECIFIED_CAUSE
  const token = trustReason ?? 'unspecified'
  return (
    `Template '${clampName(template.name)}' is blocked pending OhMyClient platform-admin approval — an ` +
    `OhMyClient check, NOT WhatsApp/Meta template approval (Meta is not consulted). ` +
    `Reason: ${cause} [trustReason=${token}]. ` +
    `Submit it on the WhatsApp Templates page (/dashboard/wa-templates); an admin decides ` +
    `at /admin/template-reviews. ` +
    `(campaign ${campaign.id})`
  )
}

export async function enforceTemplateReview(
  args: EnforceTemplateReviewArgs
): Promise<void> {
  const { campaign, restaurantId, template } = args
  if (!template || template.category !== 'MARKETING') return
  const result = await checkTemplateReview({
    restaurantId,
    templateName: template.name,
  })
  if (result.allowed) return
  throw new CampaignGuardrailError([
    buildBlockedMessage(template, campaign, result.trustReason),
  ])
}
