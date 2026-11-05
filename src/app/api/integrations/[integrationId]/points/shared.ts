import { NextResponse } from 'next/server'
import { IntegrationAuthError } from '../verify-signature'

export const MAX_PAYLOAD_BYTES = 8192

export function validateBody(body: Record<string, unknown>): string | null {
  if (!body.points || typeof body.points !== 'number' || body.points <= 0) {
    return 'points must be a positive number'
  }
  if (!body.memberId && !body.phone) {
    return 'Either memberId or phone is required'
  }
  return null
}

export function buildErrorResponse(error: unknown): NextResponse {
  if (error instanceof IntegrationAuthError) {
    return NextResponse.json(
      { error: error.message },
      { status: error.statusCode }
    )
  }
  const message = error instanceof Error ? error.message : ''
  if (message.includes('not found')) {
    return NextResponse.json({ error: 'Member not found' }, { status: 404 })
  }
  if (message.includes('must be positive')) {
    return NextResponse.json({ error: 'Points must be positive' }, { status: 400 })
  }
  if (message.includes('Insufficient')) {
    return NextResponse.json({ error: 'Insufficient points balance' }, { status: 422 })
  }
  console.error('[PointsAPI] Unexpected error:', error)
  return NextResponse.json({ error: 'Internal error' }, { status: 500 })
}
