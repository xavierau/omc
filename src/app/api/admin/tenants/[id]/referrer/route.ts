import { NextRequest, NextResponse } from 'next/server'
import { assertPlatformAdmin } from '@/infrastructure/supabase/guards/platform-admin-guard'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'
import { checkAdminRateLimit } from '@/infrastructure/rate-limit/admin-rate-limit'
import { logAdminAction, extractIp } from '@/infrastructure/supabase/audit-logger'
import { updateRestaurant } from '@/infrastructure/supabase/repositories/restaurant-admin-repository'
import { findReferrerById } from '@/infrastructure/supabase/repositories/referrer-repository'
import { isValidUUID } from '@/infrastructure/validation/validators'

interface RouteParams {
  params: Promise<{ id: string }>
}

export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const { userId } = await assertPlatformAdmin()
    if (!checkAdminRateLimit(userId).success) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }

    const { id } = await params
    const body = await request.json()
    const { referrerId } = body as { referrerId: string | null }

    const validationError = validateInput(id, referrerId)
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 })
    }

    if (referrerId !== null) {
      const referrer = await findReferrerById(referrerId)
      if (!referrer) {
        return NextResponse.json({ error: 'Referrer not found' }, { status: 404 })
      }
      if (referrer.status !== 'active') {
        return NextResponse.json({ error: 'Referrer is not active' }, { status: 400 })
      }
    }

    const updated = await updateRestaurant(id, { referrer_id: referrerId })

    logAdminAction({
      userId,
      action: 'tenant.assign_referrer',
      resourceType: 'tenant',
      resourceId: id,
      details: { referrerId },
      ipAddress: extractIp(request),
    })

    return NextResponse.json(updated)
  } catch (error) {
    return handleError(error)
  }
}

function validateInput(
  tenantId: string,
  referrerId: string | null
): string | null {
  if (!isValidUUID(tenantId)) return 'Invalid tenant ID'
  if (referrerId !== null && !isValidUUID(referrerId)) {
    return 'Invalid referrer ID'
  }
  return null
}

function handleError(error: unknown) {
  if (error instanceof AuthError) {
    return NextResponse.json({ error: error.message }, { status: error.statusCode })
  }
  console.error('Assign referrer error:', error)
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
}
