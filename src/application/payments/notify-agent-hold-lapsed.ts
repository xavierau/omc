/**
 * BOOK-014 W6a (spec UI Feedback States, AI agent row: "Lapsed: agent says the
 * hold lapsed and offers to start again"): the lapse hook. When holds lapse
 * (the cron's expireDeposits, or the provider's "session expired" event), a
 * booking made by the WhatsApp AI agent gets one fixed free-form text in the
 * diner's language (holdLapsedText) with the tenant's AI disclosure (R11),
 * through the same sender as the AI agent's link text. The diner wrote within
 * the last 30 minutes, so the service window is open.
 *
 * Sent once: the lapse RPC returns a deposit only to the call that lapsed it.
 * Personal-agent (PAP) and booking page holds send nothing new. Failures are
 * logged with ids only, never retried, and never thrown: the expiry batch and
 * the webhook answer are never blocked.
 */
import type { BookingDeposit } from '@/domain/entities/booking-deposit'
import type { LapsedHoldBooking, LapsedHoldBookingReader, PaymentLog } from '@/domain/ports/booking-deposit'
import type { LanguageCode } from '@/domain/value-objects/language'
import { holdLapsedText } from '@/domain/value-objects/deposit-messages'
import { withDisclosure } from '@/domain/services/agent-reply-text'

export interface AgentHoldLapsedDeps {
  bookings: LapsedHoldBookingReader
  /** The diner's language (member's own, else the default), as the booking sender picks it. */
  language(restaurantId: string, phone: string): Promise<LanguageCode>
  /** The tenant's AI disclosure text (agent config). */
  disclosure(restaurantId: string): Promise<string>
  /** The AI agent's free-form sender; true when sent. */
  sendText(restaurantId: string, phone: string, text: string): Promise<boolean>
  log: PaymentLog
}

type AiHold = LapsedHoldBooking & { phone: string }

const isAiAgentHold = (b: LapsedHoldBooking): b is AiHold => b.source === 'agent' && !b.personalAgent && b.phone !== null

async function notifyOne(deps: AgentHoldLapsedDeps, b: AiHold): Promise<void> {
  try {
    const [language, disclosure] = await Promise.all([deps.language(b.restaurantId, b.phone), deps.disclosure(b.restaurantId)])
    const text = holdLapsedText(language, { date: b.bookingDate, time: b.bookingTime, partySize: b.partySize })
    const sent = await deps.sendText(b.restaurantId, b.phone, withDisclosure(text, disclosure))
    if (!sent) deps.log('warn', 'deposit.lapse_notice_failed', { bookingId: b.id, reason: 'not_sent' })
  } catch (err) {
    deps.log('warn', 'deposit.lapse_notice_failed', { bookingId: b.id, error: (err as Error).name })
  }
}

export function agentHoldLapsedNotice(deps: AgentHoldLapsedDeps): (lapsed: BookingDeposit[]) => Promise<void> {
  return async (lapsed) => {
    if (lapsed.length === 0) return
    let bookings: LapsedHoldBooking[]
    try {
      bookings = await deps.bookings.findForDeposits(lapsed.map((d) => ({ restaurantId: d.restaurantId, bookingId: d.bookingId })))
    } catch (err) {
      deps.log('warn', 'deposit.lapse_notice_failed', { count: lapsed.length, error: (err as Error).name })
      return
    }
    for (const b of bookings.filter(isAiAgentHold)) await notifyOne(deps, b)
  }
}
