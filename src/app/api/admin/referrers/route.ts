import { NextRequest, NextResponse } from 'next/server'
import { assertPlatformAdmin } from '@/infrastructure/supabase/guards/platform-admin-guard'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'
import { listReferrersUseCase } from '@/application/list-referrers'
import { createReferrerUseCase } from '@/application/create-referrer'
import { logAdminAction, extractIp } from '@/infrastructure/supabase/audit-logger'
import { checkAdminRateLimit } from '@/infrastructure/rate-limit/admin-rate-limit'
import {
  validateCreateReferrer,
  ReferrerValidationError,
} from '@/infrastructure/validation/referrer-validators'

export async function GET(request: NextRequest) {
  try {
    const { userId } = await assertPlatformAdmin()
    if (!checkAdminRateLimit(userId).success) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }
    const { searchParams } = request.nextUrl
    const status = parseStatus(searchParams.get('status'))

    const referrers = await listReferrersUseCase({ status })
    return NextResponse.json({ referrers })
  } catch (error) {
    return handleError(error, 'Referrer list error')
  }
}

export async function POST(request: NextRequest) {
  try {
    const { userId } = await assertPlatformAdmin()
    if (!checkAdminRateLimit(userId).success) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }
    const body = await request.json()
    validateCreateReferrer(body)

    const result = await createReferrerUseCase({
      name: body.name,
      contactEmail: body.contactEmail,
      contactPhone: body.contactPhone,
      commissionPerMessageHkd: body.commissionPerMessageHkd,
      commissionPerRedemptionHkd: body.commissionPerRedemptionHkd,
    })

    if (!result.success) {
      return NextResponse.json({ error: result.message }, { status: 400 })
    }

    logAdminAction({
      userId,
      action: 'referrer.create',
      resourceType: 'referrer',
      resourceId: result.referrer.id,
      details: { name: body.name, contactEmail: body.contactEmail },
      ipAddress: extractIp(request),
    })

    return NextResponse.json(result.referrer, { status: 201 })
  } catch (error) {
    return handleError(error, 'Referrer create error')
  }
}

function parseStatus(
  value: string | null
): 'active' | 'inactive' | 'all' | undefined {
  if (value === 'active' || value === 'inactive' || value === 'all') return value
  return undefined
}

function handleError(error: unknown, label: string) {
  if (error instanceof AuthError) {
    return NextResponse.json({ error: error.message }, { status: error.statusCode })
  }
  if (error instanceof ReferrerValidationError) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }
  console.error(`${label}:`, error)
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
}
