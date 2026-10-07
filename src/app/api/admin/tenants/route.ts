import { NextRequest, NextResponse } from 'next/server'
import { assertPlatformAdmin } from '@/infrastructure/supabase/guards/platform-admin-guard'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'
import { listAll } from '@/infrastructure/supabase/repositories/restaurant-admin-repository'
import { createTenant, TenantValidationError } from '@/application/create-tenant'
import { logAdminAction, extractIp } from '@/infrastructure/supabase/audit-logger'
import { checkAdminRateLimit } from '@/infrastructure/rate-limit/admin-rate-limit'
import { validateCreateTenant, ValidationError } from '@/infrastructure/validation/tenant-validators'

export async function GET(request: NextRequest) {
  try {
    const { userId } = await assertPlatformAdmin()
    if (!checkAdminRateLimit(userId).success) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }
    const { searchParams } = request.nextUrl
    const search = searchParams.get('search') ?? undefined
    const status = parseStatus(searchParams.get('status'))
    const page = parseInt(searchParams.get('page') ?? '1', 10)
    const limit = parseInt(searchParams.get('limit') ?? '20', 10)

    const result = await listAll({ search, status, page, limit })
    return NextResponse.json({ ...result, page, limit })
  } catch (error) {
    return handleError(error, 'Tenant list error')
  }
}

export async function POST(request: NextRequest) {
  try {
    const { userId } = await assertPlatformAdmin()
    if (!checkAdminRateLimit(userId).success) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }
    const body = await request.json()
    validateCreateTenant(body)

    const result = await createTenant({
      name: body.name,
      slug: body.slug,
      whatsappNumber: body.whatsappNumber,
      kapsoPhoneNumberId: body.kapsoPhoneNumberId,
      metaBusinessAccountId: body.metaBusinessAccountId,
      adminEmail: body.adminEmail,
      adminPassword: body.adminPassword,
    })

    logAdminAction({
      userId,
      action: 'tenant.create',
      resourceType: 'tenant',
      resourceId: result.id,
      details: { name: body.name, slug: body.slug },
      ipAddress: extractIp(request),
    })

    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    return handleError(error, 'Tenant create error')
  }
}

function parseStatus(
  value: string | null
): 'active' | 'inactive' | 'trial' | 'all' | undefined {
  if (value === 'active' || value === 'inactive' || value === 'trial' || value === 'all') return value
  return undefined
}

function handleError(error: unknown, label: string) {
  if (error instanceof AuthError) {
    return NextResponse.json({ error: error.message }, { status: error.statusCode })
  }
  if (error instanceof ValidationError) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }
  if (error instanceof TenantValidationError) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }
  console.error(`${label}:`, error)
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
}
