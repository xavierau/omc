import { NextRequest, NextResponse } from 'next/server'
import { assertPlatformAdmin } from '@/infrastructure/supabase/guards/platform-admin-guard'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'
import { getReferrerDetailUseCase } from '@/application/get-referrer-detail'
import { updateReferrerUseCase } from '@/application/update-referrer'
import { logAdminAction, extractIp } from '@/infrastructure/supabase/audit-logger'
import { checkAdminRateLimit } from '@/infrastructure/rate-limit/admin-rate-limit'
import {
  validateUpdateReferrer,
  ReferrerValidationError,
} from '@/infrastructure/validation/referrer-validators'

interface RouteParams {
  params: Promise<{ id: string }>
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const { userId } = await assertPlatformAdmin()
    if (!checkAdminRateLimit(userId).success) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }
    const { id } = await params
    const detail = await getReferrerDetailUseCase(id)
    if (!detail) {
      return NextResponse.json({ error: 'Referrer not found' }, { status: 404 })
    }
    return NextResponse.json(detail)
  } catch (error) {
    return handleError(error, 'Referrer detail error')
  }
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const { userId } = await assertPlatformAdmin()
    if (!checkAdminRateLimit(userId).success) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }
    const { id } = await params
    const body = await request.json()
    validateUpdateReferrer(id, body)

    const result = await updateReferrerUseCase({
      id,
      name: body.name,
      contactEmail: body.contactEmail,
      contactPhone: body.contactPhone,
      commissionPerMessageHkd: body.commissionPerMessageHkd,
      commissionPerRedemptionHkd: body.commissionPerRedemptionHkd,
      status: body.status,
    })

    if (!result.success) {
      return NextResponse.json({ error: result.message }, { status: 404 })
    }

    logAdminAction({
      userId,
      action: 'referrer.update',
      resourceType: 'referrer',
      resourceId: id,
      details: {
        name: body.name,
        contactEmail: body.contactEmail,
        contactPhone: body.contactPhone,
        commissionPerMessageHkd: body.commissionPerMessageHkd,
        commissionPerRedemptionHkd: body.commissionPerRedemptionHkd,
        status: body.status,
      },
      ipAddress: extractIp(request),
    })

    return NextResponse.json(result.referrer)
  } catch (error) {
    return handleError(error, 'Referrer update error')
  }
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
