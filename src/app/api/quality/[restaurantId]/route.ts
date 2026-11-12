// WAQ-012: GET /api/quality/[restaurantId] — single-tenant quality detail.
//
// Authorization: a platform admin can read any tenant; a tenant user can
// read ONLY the tenant id stored in their session cookie. The "either-or"
// pattern is implemented by attempting the admin guard first, then falling
// back to the tenant guard. Both throw `AuthError`; the per-tenant ownership
// check is a follow-up assertion after the tenant guard succeeds.

import { NextRequest, NextResponse } from 'next/server'
import { assertPlatformAdmin } from '@/infrastructure/supabase/guards/platform-admin-guard'
import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'
import { getSingleTenantQuality } from '@/application/get-tenant-quality-overview'

interface RouteParams {
  params: Promise<{ restaurantId: string }>
}

const DEFAULT_WINDOW_DAYS = 7

async function authorize(restaurantId: string): Promise<void> {
  try {
    await assertPlatformAdmin()
    return
  } catch (err) {
    if (!(err instanceof AuthError)) throw err
    // Fall through to tenant-context check. A 401 (unauthenticated) here is
    // intentionally re-raised by the tenant guard with the same status, so
    // the caller still sees 401 rather than a 403 mask.
  }
  const ctx = await getTenantContext()
  if (ctx.restaurantId !== restaurantId) {
    throw new AuthError('Forbidden: cross-tenant access', 403)
  }
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const { restaurantId } = await params
    await authorize(restaurantId)
    const row = await getSingleTenantQuality({
      restaurantId,
      windowDays: DEFAULT_WINDOW_DAYS,
    })
    if (!row) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })
    }
    return NextResponse.json({ row })
  } catch (error) {
    return handleError(error, 'Single tenant quality error')
  }
}

function handleError(error: unknown, label: string) {
  if (error instanceof AuthError) {
    return NextResponse.json(
      { error: error.message },
      { status: error.statusCode }
    )
  }
  console.error(`${label}:`, error)
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
}
