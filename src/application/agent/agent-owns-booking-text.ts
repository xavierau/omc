/**
 * AGENT-004: whether unmatched diner text goes straight to the reply agent,
 * skipping BOOK-001's booking-intent classifier.
 *
 * The classifier sees one message and can only offer a NEW booking; when the
 * auto agent has a booking tool it must own the conversation (a reply to the
 * agent's own question is not a new booking). Any read failure answers false,
 * i.e. today's order, classifier first (BOOK-001 R12 fall-open). Logs carry
 * ids and outcomes only (R8).
 */
import type { AgentConfig } from '@/domain/value-objects/agent-config'
import type { BookingConfig } from '@/domain/value-objects/booking-config'
import type { AgentLogFn } from './admit-inbound-for-agent'
import { agentOffersBookingTools } from './agent-tools'

export interface AgentBookingOwnerDeps {
  getAgentConfig(restaurantId: string): Promise<AgentConfig>
  getBookingConfig(restaurantId: string): Promise<BookingConfig>
  log: AgentLogFn
}

export async function agentOwnsBookingText(deps: AgentBookingOwnerDeps, restaurantId: string): Promise<boolean> {
  try {
    const [agent, booking] = await Promise.all([deps.getAgentConfig(restaurantId), deps.getBookingConfig(restaurantId)])
    const owns = agentOffersBookingTools(agent, booking.mode)
    if (owns) deps.log('info', 'agent.owns_booking_text', { restaurantId })
    return owns
  } catch (err) {
    deps.log('warn', 'agent.booking_owner_read_failed', { restaurantId, errorClass: (err as Error)?.name ?? 'unknown' })
    return false
  }
}
