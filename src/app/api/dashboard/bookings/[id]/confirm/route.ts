import type { NextRequest } from 'next/server'
import { handleBookingDecision } from '../../decision-response'

export function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handleBookingDecision(request, params, 'confirmed')
}
