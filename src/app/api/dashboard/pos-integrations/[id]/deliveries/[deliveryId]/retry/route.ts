import { NextRequest, NextResponse } from 'next/server'
import { getIntegration } from '@/application/configure-pos-integration'
import { retryDelivery } from '@/application/retry-delivery'
import { findDeliveryById } from '@/infrastructure/supabase/repositories/integration-delivery-repository'
import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { requireTenantAdmin } from '@/infrastructure/supabase/guards/require-tenant-admin'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'

type RouteContext = { params: Promise<{ id: string; deliveryId: string }> }

/**
 * `retryDelivery(deliveryId)` (WI-6) is scoped by deliveryId alone -- it
 * expects ITS CALLER to have already proven `deliveryId` belongs to the
 * `[id]` integration (and transitively this tenant) before calling it
 * ("its route already does a scoped existence check", WI-6's own handoff).
 * That scoping happens here: the delivery is loaded and its
 * integrationId/restaurantId compared against the route param and the
 * tenant context BEFORE `retryDelivery` ever runs (#111 lesson — a
 * same-tenant admin must not be able to retry another tenant's, or another
 * integration's, delivery just by knowing its uuid).
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

    const delivery = await findDeliveryById(deliveryId)
    if (!delivery || delivery.snapshot.integrationId !== id || delivery.snapshot.restaurantId !== ctx.restaurantId) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 })
    }

    const result = await retryDelivery(deliveryId)
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
