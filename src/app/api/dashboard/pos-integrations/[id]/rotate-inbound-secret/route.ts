import { NextRequest, NextResponse } from 'next/server'
import { getIntegration, rotateInboundSecret } from '@/application/configure-pos-integration'
import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { requireTenantAdmin } from '@/infrastructure/supabase/guards/require-tenant-admin'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'

type RouteContext = { params: Promise<{ id: string }> }

/**
 * Server-minted rotation of the inbound (partner-signs) webhook secret
 * (OQ-5). This is the ONE endpoint allowed to set webhook_secret — never
 * PATCH (T-C4). The new secret is returned once, in this response only;
 * every dashboard read shows secretLast4 (T-H1).
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

    const webhookSecret = await rotateInboundSecret(id, ctx.userId)
    return NextResponse.json({ webhookSecret })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }
    console.error('POS integration rotate-inbound-secret error:', error)
    return NextResponse.json({ error: 'Failed to rotate webhook secret' }, { status: 500 })
  }
}
