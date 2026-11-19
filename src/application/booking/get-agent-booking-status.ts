/**
 * BOOK-003 (R36): an agent follows its booking request. The status token
 * from the create response is the whole authorisation; a missing, malformed
 * or wrong token, another booking's token, an unknown id and a disabled or
 * rotated agent booking id all answer not_found alike. The view carries no
 * phone and no name.
 */
import { STATUS_TOKEN_SHAPE, agentBookingStatusView, type AgentBookingStatusView } from '@/domain/services/agent-booking'
import type { AgentBookingDirectory, AgentBookingStore } from '@/domain/ports/booking'
import { statusTokenMatches } from './agent-booking-secrets'
import { resolveAgentBookingTenant } from './resolve-agent-booking-tenant'

export interface GetAgentBookingStatusDeps {
  directory: AgentBookingDirectory
  store: Pick<AgentBookingStore, 'find'>
  now(): Date
}

export type GetAgentBookingStatusResult = { ok: true; view: AgentBookingStatusView } | { ok: false; reason: 'not_found' }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const NOT_FOUND = { ok: false, reason: 'not_found' } as const

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
  return { ok: true, view: agentBookingStatusView(booking, deps.now()) }
}
