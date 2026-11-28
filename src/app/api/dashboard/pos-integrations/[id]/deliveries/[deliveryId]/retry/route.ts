import { NextRequest, NextResponse } from 'next/server'
import { getIntegration } from '@/application/configure-pos-integration'
import { retryDelivery } from '@/application/retry-delivery'
import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { requireTenantAdmin } from '@/infrastructure/supabase/guards/require-tenant-admin'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'

type RouteContext = { params: Promise<{ id: string; deliveryId: string }> }

/**
 * WI-14 (G-5, grok review, SEC-001/#111 pattern): `retryDelivery` now
 * looks up the delivery via a query scoped by BOTH `integrationId` and
 * `restaurantId` (`findDeliveryByIdForIntegration`), so a foreign-tenant
 * or foreign-integration delivery id resolves to `not_found` from the
 * query itself -- no separate unscoped-fetch-then-compare needed here.
 * `getIntegration(id, ctx.restaurantId)` (already tenant-scoped) still
 * gates the route so a bad integration id 404s before even reaching the
 * delivery lookup.
 */
export async function POST(_request: NextRequest, context: RouteContext) {
  try {
    const ctx = await getTenantContext()
    requireTenantAdmin(ctx)
    const { id, deliveryId } = await context.params
    const integration = await getIntegration(id, ctx.restaurantId)
    if (!integration) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const result = await retryDelivery(deliveryId, id, ctx.restaurantId)
    if (!result.ok) {
      if (result.error === 'already_retried') {
        return NextResponse.json({ error: 'already_retried' }, { status: 409 })
      }
      return NextResponse.json({ error: result.error }, { status: 404 })
    }

    return NextResponse.json({ status: 'ok' }, { status: 202 })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }
    console.error('Delivery retry POST error:', error)
    return NextResponse.json({ error: 'Failed to retry delivery' }, { status: 500 })
  }
}
