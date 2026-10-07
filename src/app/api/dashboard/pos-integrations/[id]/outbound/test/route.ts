import { NextRequest, NextResponse } from 'next/server'
import { getIntegration } from '@/application/configure-pos-integration'
import { sendTestEvent } from '@/application/send-test-event'
import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { requireTenantAdmin } from '@/infrastructure/supabase/guards/require-tenant-admin'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'

type RouteContext = { params: Promise<{ id: string }> }

/**
 * `sendTestEvent` (WI-6) returns a third outcome, `not_eligible_for_
 * delivery`, beyond the plan's originally-documented two-code contract
 * (`url_not_saved` only) -- it fires when the URL is saved but
 * `outboundEnabled`/the PII ack aren't, so the migration-071 fan-out
 * trigger created no delivery row at all. Surfaced here as its own 422
 * code rather than folded into `url_not_saved` (which would be factually
 * wrong -- the URL IS saved) or silently dropped. Flagged in the handoff
 * artifact as a documented deviation from the plan's literal two-outcome
 * list, driven by WI-6's already-shipped three-state service.
 */
export async function POST(_request: NextRequest, context: RouteContext) {
  try {
    const ctx = await getTenantContext()
    requireTenantAdmin(ctx)
    const { id } = await context.params
    const integration = await getIntegration(id, ctx.restaurantId)
    if (!integration) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const result = await sendTestEvent(id, ctx.restaurantId)
    if (!result.ok) {
      if (result.error === 'integration_not_found') {
        return NextResponse.json({ error: result.error }, { status: 404 })
      }
      return NextResponse.json({ error: result.error }, { status: 422 })
    }

    return NextResponse.json({ deliveryId: result.deliveryId }, { status: 202 })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }
    console.error('Outbound test-event POST error:', error)
    return NextResponse.json({ error: 'Failed to send test event' }, { status: 500 })
  }
}
