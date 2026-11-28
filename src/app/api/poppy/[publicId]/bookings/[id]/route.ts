/**
 * BOOK-003 (R36): GET /api/poppy/{publicId}/bookings/{id}, an agent follows
 * its booking request. The status token travels in X-Booking-Status-Token,
 * never in the URL (PAP 5.6), and `Authorization` stays free for PAP access
 * tokens. Wrong, missing or another booking's token → 404, as an unknown id.
 */
import { NextRequest } from 'next/server'
import { getAgentBookingStatus } from '@/application/booking/get-agent-booking-status'
import { getAgentBookingStatusDeps } from '@/application/booking/booking-deps'
import { agentJson, notFound } from '../../../agent-api-response'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest, { params }: { params: Promise<{ publicId: string; id: string }> }) {
  const { publicId, id } = await params
  try {
    const result = await getAgentBookingStatus(getAgentBookingStatusDeps(), {
      publicId,
      bookingId: id,
      statusToken: request.headers.get('x-booking-status-token'),
    })
    return result.ok ? agentJson(result.view, 200) : notFound()
  } catch (err) {
    console.error('[AgentBooking] status read failed:', { error: (err as Error).name, bookingId: id })
    return agentJson({ error: 'server_error', error_description: 'Try again.' }, 500)
  }
}
