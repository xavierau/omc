// INT-001 WI-8 US-9/OD-9: `PUT /api/dashboard/pos-integrations/[id]/outbound-secret`.
// The secret is minted by the PARTNER's system and pasted by the owner --
// unlike the inbound secret (WI-0's rotate-inbound-secret, platform-minted),
// this route never generates a value itself. Replacement is immediate, no
// grace window (OD-9) -- already-queued deliveries sign with whatever
// `readOutboundSecret` returns at ATTEMPT time (WI-6), so a swap here takes
// effect on the very next attempt with no coordination needed here.

import { isValidOutboundSecret } from '@/infrastructure/validation/integration-settings-validators'
import {
  findIntegrationSettingsByIdForRestaurant,
  setOutboundSecret as persistOutboundSecret,
} from '@/infrastructure/supabase/repositories/integration-settings-repository'
import { recordIntegrationSettingsAudit } from '@/infrastructure/supabase/repositories/integration-settings-audit-repository'

export type SetOutboundSecretResult =
  | { ok: true; last4: string; updatedAt: string }
  | { ok: false; error: 'secret_too_short' }

export async function setOutboundSecret(
  integrationId: string,
  restaurantId: string,
  rawSecret: unknown,
  actorUserId: string
): Promise<SetOutboundSecretResult> {
  if (!isValidOutboundSecret(rawSecret)) {
    return { ok: false, error: 'secret_too_short' }
  }

  // G-5 (WI-14, grok review, SEC-001/#111 pattern): scoped by BOTH ids in
  // the query itself, not fetch-then-compare -- defense in depth alongside
  // the route's own `getIntegration(id, ctx.restaurantId)` pre-check.
  const before = await findIntegrationSettingsByIdForRestaurant(integrationId, restaurantId)
  const oldLast4 = before?.snapshot.outboundSecretLast4 ?? null

  const { last4, updatedAt } = await persistOutboundSecret({
    integrationId,
    restaurantId,
    plaintext: rawSecret,
    actorUserId,
  })

  // T-H1: only ever last4, never the plaintext or ciphertext, in the audit
  // trail -- matches `integration-settings-audit-repository.ts`'s own
  // header comment ("callers must never pass a plaintext or ciphertext
  // secret as oldValue/newValue").
  await recordIntegrationSettingsAudit({
    integrationId,
    restaurantId,
    actorUserId,
    field: 'outboundSecret',
    oldValue: oldLast4,
    newValue: last4,
  })

  return { ok: true, last4, updatedAt }
}
