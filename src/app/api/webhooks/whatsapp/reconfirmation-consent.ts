// WONB-008 Stream C: YES handler for the re-confirmation campaign.
// Mirrors WONB-007's `optin-confirmation.ts` pattern: errors propagate so
// Kapso retries; `confirmReconfirmationConsent` is idempotent (the WHERE
// clause `consent_grade='weak' AND status='opted_in'` excludes already-
// upgraded rows on retry, returning `upgraded=false`).

import { confirmReconfirmationConsent } from '@/application/confirm-reconfirmation-consent'
import { sendTextMessage } from '@/infrastructure/whatsapp/messaging'
import { isWindowOpen } from '@/infrastructure/supabase/repositories/conversation-window-repository'

interface Ctx {
  phoneNumberId: string
  phone: string
  restaurantId: string
}

const CONFIRMED_REPLY = 'Confirmed — thanks for verifying.'

/**
 * Returns true ONLY when a weak+opted_in row was upgraded — caller stops
 * dispatching. False (no upgrade) means the row was already strong, never
 * existed, or was opted_out — caller falls through to `handleUnknown`.
 */
export async function handleReconfirmationConsent(ctx: Ctx): Promise<boolean> {
  const { upgraded } = await confirmReconfirmationConsent({
    restaurantId: ctx.restaurantId,
    phoneE164: ctx.phone,
  })
  if (!upgraded) return false
  await replyIfWindowOpen(ctx)
  return true
}

async function replyIfWindowOpen(ctx: Ctx): Promise<void> {
  const open = await isWindowOpen({
    restaurantId: ctx.restaurantId,
    phoneE164: ctx.phone,
  })
  if (!open) return
  await sendTextMessage(ctx.phoneNumberId, ctx.phone, CONFIRMED_REPLY)
}
