/**
 * BOOK-003: POST /api/poppy/{publicId}/bookings, a personal agent requests a
 * table (PAP 1.0 section 7, signed out).
 *
 * Unauthenticated by design. The agent booking id in the path is the only
 * source of the restaurant (R33). The Poppy-Session header is accepted and
 * never read (R40): no behaviour depends on any agent-supplied identity.
 * Query parameters are never read.
 */
import { NextRequest } from 'next/server'
import { createAgentBooking, type CreateAgentBookingResult } from '@/application/booking/create-agent-booking'
import { createAgentBookingDeps } from '@/application/booking/booking-deps'
import { extractTrustedClientIp } from '@/application/integration-inbound-guard'
import { agentError, agentJson, notFound } from '../../agent-api-response'

export const dynamic = 'force-dynamic'

function toResponse(result: CreateAgentBookingResult) {
  if (result.ok) return agentJson(result.body, result.kind === 'awaiting_confirmation' ? 202 : 200)
  switch (result.reason) {
    case 'rate_limited':
      return agentError('rate_limited', 429, 'Too many requests. Wait for Retry-After seconds.', { retryAfterSec: result.retryAfterSec })
    case 'not_found':
      return notFound()
    case 'invalid':
      return agentError('invalid_request', 400, 'A field is missing or invalid.', { fields: result.errors, suggestedTimes: result.suggestedTimes })
    case 'idempotency_conflict':
      return agentError('idempotency_conflict', 409, result.description)
    default:
      return agentError('server_error', 500, 'The booking could not be saved. Try again.')
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ publicId: string }> }) {
  const { publicId } = await params
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return agentError('invalid_request', 400, 'The body must be JSON.')
  }
  try {
    const result = await createAgentBooking(createAgentBookingDeps(), {
      publicId,
      body,
      clientIp: extractTrustedClientIp(request),
      idempotencyKey: request.headers.get('idempotency-key'),
    })
    return toResponse(result)
  } catch (err) {
    console.error('[AgentBooking] create route failed:', (err as Error).name)
    return agentError('server_error', 500, 'The booking could not be saved. Try again.')
  }
}
