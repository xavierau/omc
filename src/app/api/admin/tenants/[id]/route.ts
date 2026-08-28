import { NextRequest, NextResponse } from 'next/server'
import { assertPlatformAdmin } from '@/infrastructure/supabase/guards/platform-admin-guard'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'
import { getTenantDetail } from '@/application/get-tenant-detail'
import { updateRestaurant } from '@/infrastructure/supabase/repositories/restaurant-admin-repository'
import { logAdminAction, extractIp } from '@/infrastructure/supabase/audit-logger'
import { checkAdminRateLimit } from '@/infrastructure/rate-limit/admin-rate-limit'
import { validateUpdateTenant, ValidationError } from '@/infrastructure/validation/tenant-validators'

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
    const detail = await getTenantDetail(id)
    if (!detail) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })
    }
    return NextResponse.json(detail)
  } catch (error) {
    return handleError(error, 'Tenant detail error')
  }
}

export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const { userId } = await assertPlatformAdmin()
    if (!checkAdminRateLimit(userId).success) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }
    const { id } = await params
    const body = await request.json()
    validateUpdateTenant(id, body)

    const updates = stripUndefined({
      name: body.name,
      whatsapp_number: body.whatsappNumber,
      kapso_phone_number_id: body.kapsoPhoneNumberId,
      meta_business_account_id: body.metaBusinessAccountId,
      status: body.status,
      trial_expires_at: body.trialExpiresAt,
    })
    const updated = await updateRestaurant(id, updates)

    logAdminAction({
      userId,
      action: 'tenant.update',
      resourceType: 'tenant',
      resourceId: id,
      details: updates,
      ipAddress: extractIp(request),
    })

    return NextResponse.json(updated)
  } catch (error) {
    return handleError(error, 'Tenant update error')
  }
}

function stripUndefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined)
  ) as Partial<T>
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
