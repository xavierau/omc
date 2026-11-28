/**
 * BOOK-014 W6a (W5 merge note D1): the one paid-event hook the webhook runs.
 * It composes the booking page's hook (chat, campaign → "received", W3) and
 * the agent and staff hook (AI agent and personal agents → "received", staff
 * → "confirmed", W5). Each hook filters on its own sources, so every paid
 * booking gets exactly one diner message. handlePaymentEvent calls this only
 * on the transition out of awaiting_deposit, so a replay sends nothing.
 */
import { bookingPagePaidHook } from './notify-deposit-paid'
import { agentAndStaffPaidHook, type ChannelPaidHookDeps } from './notify-agent-deposit-paid'
import type { DepositPaid } from './handle-payment-event'

export function depositPaidHook(deps: ChannelPaidHookDeps): (paid: DepositPaid) => Promise<void> {
  const hooks = [bookingPagePaidHook(deps), agentAndStaffPaidHook(deps)]
  return async (paid) => {
    for (const hook of hooks) await hook(paid)
  }
}
