/**
 * BOOK-003 (R33, R43): the restaurant behind an agent booking id. Null, and
 * so a 404 for the agent, when the id is malformed, unknown or rotated away,
 * when agent booking is off, or when booking mode is not Simple. The id in
 * the stored config is compared again so a stale index hit can never route a
 * request to a tenant that rotated.
 */
import { isAgentPublicId } from '@/domain/value-objects/booking-config'
import type { AgentBookingDirectory, AgentBookingTenant } from '@/domain/ports/booking'

export async function resolveAgentBookingTenant(
  directory: AgentBookingDirectory,
  publicId: string
): Promise<AgentBookingTenant | null> {
  if (!isAgentPublicId(publicId)) return null
  const tenant = await directory.findByPublicId(publicId)
  if (!tenant) return null
  const { mode, agentBooking } = tenant.config
  if (!agentBooking.enabled || agentBooking.publicId !== publicId || mode !== 'simple') return null
  return tenant
}
