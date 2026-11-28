/**
 * BOOK-003 (R36): an agent follows its booking request. The status token
 * from the create response is the whole authorisation; a missing, malformed
 * or wrong token, another booking's token, an unknown id and a disabled or
 * rotated agent booking id all answer not_found alike. The view carries no
 * phone and no name.
 *
 * BOOK-014 W5 (spec AC-10; threat R62): while the booking is awaiting_deposit
 * the view adds `deposit` {amount, currency, expires_at} and `payment_url`:
 * the hosted payment URL stored at start, handed out only when its host is in
 * the provider's allow-list (as W4's Copy link). The /p token is stored
 * hashed, so it cannot be shown again; no token is minted here.
 */
import { STATUS_TOKEN_SHAPE, agentBookingStatusView, type AgentBookingStatusView } from '@/domain/services/agent-booking'
import { agentDepositView, type AgentDepositView } from '@/domain/services/agent-booking-deposit'
import type { AgentBooking } from '@/domain/entities/booking-request'
import type { AgentBookingDirectory, AgentBookingStore } from '@/domain/ports/booking'
import type { BookingDepositStore } from '@/domain/ports/booking-deposit'
import type { PaymentGatewayRegistry } from '@/domain/ports/payment-gateway'
import { isAllowedRedirect } from '@/application/payments/resolve-payment-link'
import { statusTokenMatches } from './agent-booking-secrets'
import { resolveAgentBookingTenant } from './resolve-agent-booking-tenant'

export interface GetAgentBookingStatusDeps {
  directory: AgentBookingDirectory
  store: Pick<AgentBookingStore, 'find'>
  now(): Date
  /** BOOK-014 W5: the booking's deposit (scoped by restaurant, R58) and the provider's redirect hosts; absent = none shown. */
  deposits?: { store: Pick<BookingDepositStore, 'findByBookingForRestaurant'>; registry: PaymentGatewayRegistry }
}

export type GetAgentBookingStatusResult = { ok: true; view: AgentBookingStatusView } | { ok: false; reason: 'not_found' }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const NOT_FOUND = { ok: false, reason: 'not_found' } as const

async function depositView(deps: GetAgentBookingStatusDeps, booking: AgentBooking): Promise<AgentDepositView | null> {
  if (booking.status !== 'awaiting_deposit' || !deps.deposits) return null
  const deposit = await deps.deposits.store.findByBookingForRestaurant(booking.restaurantId, booking.id)
  if (!deposit) return null
  let hosts: readonly string[] = []
  try {
    hosts = deps.deposits.registry.get(deposit.providerCode).allowedRedirectHosts
  } catch {
    // No adapter for the provider: the amount and hold end are still shown, never an unchecked URL.
  }
  return agentDepositView(deposit, (url) => isAllowedRedirect(url, hosts))
}

export async function getAgentBookingStatus(
  deps: GetAgentBookingStatusDeps,
  input: { publicId: string; bookingId: string; statusToken: string | null }
): Promise<GetAgentBookingStatusResult> {
  const { statusToken, bookingId } = input
  if (!statusToken || !STATUS_TOKEN_SHAPE.test(statusToken) || !UUID.test(bookingId)) return NOT_FOUND
  const tenant = await resolveAgentBookingTenant(deps.directory, input.publicId)
  if (!tenant) return NOT_FOUND
  const booking = await deps.store.find(bookingId, tenant.restaurantId)
  if (!booking || booking.source !== 'agent' || !statusTokenMatches(statusToken, booking.statusTokenHash)) return NOT_FOUND
  return { ok: true, view: agentBookingStatusView(booking, deps.now(), await depositView(deps, booking)) }
}
