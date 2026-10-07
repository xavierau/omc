import { NextRequest, NextResponse } from 'next/server'
import { authenticateIntegration } from '../../verify-signature'
import { deductPoints } from '@/application/adjust-points'
import { validateBody, buildErrorResponse, MAX_PAYLOAD_BYTES } from '../shared'
import { checkRateLimit } from '@/lib/rate-limit'

type RouteParams = { params: Promise<{ integrationId: string }> }

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { integrationId } = await params

  const { allowed } = checkRateLimit(`points:${integrationId}`, 30, 60_000)
  if (!allowed) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 })
  }

  try {
    const rawBody = await request.text()
    if (rawBody.length > MAX_PAYLOAD_BYTES) {
      return NextResponse.json({ error: 'Payload too large' }, { status: 413 })
    }

    const signature = request.headers.get('x-webhook-signature')
    const integration = await authenticateIntegration(
      integrationId, rawBody, signature
    )

    const body = JSON.parse(rawBody)
    const validationError = validateBody(body)
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 })
    }

    const result = await deductPoints({
      restaurantId: integration.restaurantId,
      memberId: body.memberId,
      phone: body.phone,
      points: body.points,
      reason: body.reason,
      source: body.source,
      referenceId: body.referenceId,
    })

    return NextResponse.json(result)
  } catch (error) {
    return buildErrorResponse(error)
  }
}
