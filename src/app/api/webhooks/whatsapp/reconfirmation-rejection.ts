// WONB-008: NO handler for the re-confirmation campaign.
// Mirrors `reconfirmation-consent.ts` (YES). Errors propagate so Kapso retries;
// `rejectReconfirmationConsent` is idempotent (revoke flips opted_in → opted_out
// and `findActiveConsent` already excludes opted_out rows on retry).

import { rejectReconfirmationConsent } from '@/application/reject-reconfirmation-consent'
import { sendTextMessage } from '@/infrastructure/whatsapp/messaging'
import { isWindowOpen } from '@/infrastructure/supabase/repositories/conversation-window-repository'

interface Ctx {
  phoneNumberId: string
  phone: string
  restaurantId: string
}

// Match the tone of WONB-007's NO_OFFERS_REPLY (`optin-confirmation.ts`); the
// micro-flow has no UTILITY template, so this is the free-text fallback used
// only when the 24h window is open.
const REVOKED_REPLY =
  "Got it — we won't message you about marketing again."

/**
 * Returns true ONLY when a weak+opted_in row was revoked — caller stops
 * dispatching. False (no revoke) means the row was pending, already strong,
 * already opted_out, or never existed — caller falls through to the WONB-007
 * `handleOptinRejection` (which targets pending rows).
 */
export async function handleReconfirmationRejection(ctx: Ctx): Promise<boolean> {
  const { revoked } = await rejectReconfirmationConsent({
    restaurantId: ctx.restaurantId,
    phoneE164: ctx.phone,
  })
  if (!revoked) return false
  await replyIfWindowOpen(ctx)
  return true
}

async function replyIfWindowOpen(ctx: Ctx): Promise<void> {
  const open = await isWindowOpen({
    restaurantId: ctx.restaurantId,
    phoneE164: ctx.phone,
  })
  if (!open) return
  await sendTextMessage(ctx.phoneNumberId, ctx.phone, REVOKED_REPLY)
}
