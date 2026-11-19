/**
 * BOOK-003: GET /api/poppy/{publicId}/openapi.json, the OpenAPI 3.1
 * description the restaurant's poppy.json lists (PAP section 7). Its
 * description explains the confirm-on-WhatsApp flow and carries the
 * collection statement (R44). 404 when agent booking is off (R43).
 */
import { resolveAgentBookingTenant } from '@/application/booking/resolve-agent-booking-tenant'
import { agentOpenApiFor } from '@/application/booking/agent-booking-settings'
import { agentOpenApiDeps } from '@/application/booking/booking-deps'
import { agentJson, notFound } from '../../agent-api-response'

export const dynamic = 'force-dynamic'

export async function GET(_request: Request, { params }: { params: Promise<{ publicId: string }> }) {
  const { publicId } = await params
  try {
    const deps = agentOpenApiDeps()
    const tenant = await resolveAgentBookingTenant(deps.directory, publicId)
    if (!tenant) return notFound()
    const document = await agentOpenApiFor(deps, { restaurantId: tenant.restaurantId, publicId, maxPartySize: tenant.config.maxPartySize })
    return agentJson(document, 200)
  } catch (err) {
    console.error('[AgentBooking] openapi failed:', (err as Error).name)
    return agentJson({ error: 'server_error', error_description: 'Try again.' }, 500)
  }
}
