// Shared guardrail enforcement (review round 2, #102 item 2).
//
// Extracted from execute-campaign.ts's private enforceGuardrails so the
// synchronous send-time gate in POST /api/dashboard/campaigns/[id]/execute
// can run the identical check before enqueueing — with the cron's
// documented targetMemberCount=0 (see /api/cron/campaigns/route.ts) — so a
// transient violation (tenant pause, daily limit) is caught immediately
// instead of only after the worker exhausts 3 attempts and permanently
// fails the campaign.

import { checkCampaignGuardrails } from './check-campaign-guardrails'
import { CampaignGuardrailError } from './campaign-guardrail-error'

export async function enforceCampaignGuardrails(
  restaurantId: string,
  targetMemberCount: number
): Promise<void> {
  const result = await checkCampaignGuardrails(restaurantId, targetMemberCount)
  if (!result.allowed) {
    throw new CampaignGuardrailError(result.violations)
  }
  if (result.warnings.length > 0) {
    console.warn('[Campaign] Guardrail warnings:', result.warnings)
  }
}
