// INT-001 WI-2: PATCH /api/admin/integrations/[id]/limits -- platform-admin
// override of per-integration inbound rate/queue-cap settings (spec US-5:
// "configurable per integration by platform admin, not by owner"). Mirrors
// the auth/rate-limit/validation posture of
// /api/admin/tenants/[id]/campaign-settings (PUT).

import { NextRequest, NextResponse } from 'next/server'
import { assertPlatformAdmin } from '@/infrastructure/supabase/guards/platform-admin-guard'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'
import { checkAdminRateLimit } from '@/infrastructure/rate-limit/admin-rate-limit'
import {
  updateIntegrationInboundLimits,
  type UpdateIntegrationInboundLimitsInput,
} from '@/application/update-integration-inbound-limits'

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface RouteParams {
  params: Promise<{ id: string }>
}

const FIELD_BOUNDS = {
  inboundRatePerMin: { min: 1, max: 6000 },
  inboundBurst: { min: 1, max: 1000 },
  inboundQueueCap: { min: 1, max: 100000 },
} as const

class ValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ValidationError'
  }
}

function validateInput(body: Record<string, unknown>): UpdateIntegrationInboundLimitsInput {
  const input: UpdateIntegrationInboundLimitsInput = {}
  for (const field of Object.keys(FIELD_BOUNDS) as Array<keyof typeof FIELD_BOUNDS>) {
    if (body[field] === undefined) continue
    const value = body[field]
    const { min, max } = FIELD_BOUNDS[field]
    if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
      throw new ValidationError(`${field} must be an integer between ${min} and ${max}`)
    }
    input[field] = value
  }
  if (Object.keys(input).length === 0) {
    throw new ValidationError(
      'at least one of inboundRatePerMin, inboundBurst, inboundQueueCap is required'
    )
  }
  return input
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const { userId } = await assertPlatformAdmin()
    if (!checkAdminRateLimit(userId).success) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }
    const { id } = await params
    if (!UUID_REGEX.test(id)) {
      return NextResponse.json({ error: 'Invalid integration ID' }, { status: 400 })
    }
    const body = await request.json()
    const input = validateInput(body)

    const updated = await updateIntegrationInboundLimits(id, input)
    if (!updated) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 })
    }
    return NextResponse.json({
      inboundRatePerMin: updated.snapshot.inboundRatePerMin,
      inboundBurst: updated.snapshot.inboundBurst,
      inboundQueueCap: updated.snapshot.inboundQueueCap,
    })
  } catch (error) {
    return handleError(error, 'Integration limits PATCH error')
  }
}

function handleError(error: unknown, label: string) {
  if (error instanceof AuthError) {
    return NextResponse.json({ error: error.message }, { status: error.statusCode })
  }
  if (error instanceof ValidationError) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }
  console.error(`${label}:`, error)
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
}
