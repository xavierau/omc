/**
 * BOOK-009 W4: GET /api/poppy/{publicId}/availability?from=YYYY-MM-DD&days=N[&party_size=],
 * a personal agent reads the open dates and bookable times (spec AC-11, AC-14).
 *
 * Signed out like POST /bookings (threat R2): the same per-IP limit (429 +
 * Retry-After), the agent booking id in the path as the only source of the
 * restaurant (404), and a bounded query (400). Poppy-Session is never read.
 */
import { NextRequest } from 'next/server'
import { getAgentAvailability, type GetAgentAvailabilityResult } from '@/application/booking/get-agent-availability'
import { getAgentAvailabilityDeps } from '@/application/booking/booking-deps'
import { extractTrustedClientIp } from '@/application/integration-inbound-guard'
import { agentError, agentJson, notFound } from '../../agent-api-response'

export const dynamic = 'force-dynamic'

function toResponse(result: GetAgentAvailabilityResult) {
  if (result.ok) return agentJson(result.body, 200)
  switch (result.reason) {
    case 'rate_limited':
      return agentError('rate_limited', 429, 'Too many requests. Wait for Retry-After seconds.', { retryAfterSec: result.retryAfterSec })
    case 'not_found':
      return notFound()
    case 'invalid':
      return agentError('invalid_request', 400, 'from, days or party_size is missing or invalid.', { fields: result.errors })
  }
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ publicId: string }> }) {
  const { publicId } = await params
  const q = request.nextUrl.searchParams
  try {
    const result = await getAgentAvailability(getAgentAvailabilityDeps(), {
      publicId,
      clientIp: extractTrustedClientIp(request),
      query: { from: q.get('from'), days: q.get('days'), partySize: q.get('party_size') },
    })
    return toResponse(result)
  } catch (err) {
    console.error('[AgentBooking] availability failed:', (err as Error).name)
    return agentError('server_error', 500, 'Try again later.')
  }
}
