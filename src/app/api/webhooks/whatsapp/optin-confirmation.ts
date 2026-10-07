// We deliberately let errors propagate from confirm/reject use cases up to
// the webhook 500-catch so Kapso retries. `upgradeToOptedIn` and
// pending-find+revoke are idempotent (WONB-005 + existing revoke
// behaviour), so retries are safe. Contrast with `optin-prompt.ts` which
// SWALLOWS errors — the prompt is best-effort and must never block the
// regular dispatch path.
import { confirmMarketingOptin } from '@/application/confirm-marketing-optin'
import { rejectMarketingOptin } from '@/application/reject-marketing-optin'
import { sendTextMessage } from '@/infrastructure/whatsapp/messaging'
import { isWindowOpen } from '@/infrastructure/supabase/repositories/conversation-window-repository'

interface Ctx {
  phoneNumberId: string
  phone: string
  restaurantId: string
}

const THANKS_REPLY =
  "Thanks! You'll receive special offers from us."
const NO_OFFERS_REPLY =
  "Got it, no offers will be sent. Reply YES anytime to opt back in."

/**
 * WONB-007: YES handler. Returns true ONLY when a pending marketing
 * consent was upgraded — caller stops dispatching. When the customer
 * service window is open, sends a free-text acknowledgement; closed window
 * skips the reply (we have no utility template for this micro-flow and
 * the consent flip already succeeded silently per Q-E).
 */
export async function handleOptinConfirmation(ctx: Ctx): Promise<boolean> {
  const { upgraded } = await confirmMarketingOptin({
    restaurantId: ctx.restaurantId,
    phoneE164: ctx.phone,
  })
  if (!upgraded) return false
  await replyIfWindowOpen(ctx, THANKS_REPLY)
  return true
}

/** WONB-007: NO handler. Mirror of `handleOptinConfirmation`. */
export async function handleOptinRejection(ctx: Ctx): Promise<boolean> {
  const { revoked } = await rejectMarketingOptin({
    restaurantId: ctx.restaurantId,
    phoneE164: ctx.phone,
  })
  if (!revoked) return false
  await replyIfWindowOpen(ctx, NO_OFFERS_REPLY)
  return true
}

async function replyIfWindowOpen(ctx: Ctx, body: string): Promise<void> {
  const open = await isWindowOpen({
    restaurantId: ctx.restaurantId,
    phoneE164: ctx.phone,
  })
  if (!open) return
  await sendTextMessage(ctx.phoneNumberId, ctx.phone, body)
}
