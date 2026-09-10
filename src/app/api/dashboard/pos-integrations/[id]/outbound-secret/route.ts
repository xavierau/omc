import { NextRequest, NextResponse } from 'next/server'
import { getIntegration } from '@/application/configure-pos-integration'
import { setOutboundSecret } from '@/application/set-outbound-secret'
import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { requireTenantAdmin } from '@/infrastructure/supabase/guards/require-tenant-admin'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'

type RouteContext = { params: Promise<{ id: string }> }

/**
 * OD-9: the outbound signing secret is minted by the PARTNER's system and
 * pasted here by the owner -- this route never generates one (contrast
 * with WI-0's rotate-inbound-secret, which does). Returns `last4` only,
 * never the value the caller just sent (T-H1).
 */
export async function PUT(request: NextRequest, context: RouteContext) {
  try {
    const ctx = await getTenantContext()
    requireTenantAdmin(ctx)
    const { id } = await context.params
    const integration = await getIntegration(id, ctx.restaurantId)
    if (!integration) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const body = await request.json().catch(() => null)
    const secret = body && typeof body === 'object' ? (body as Record<string, unknown>).secret : undefined

    const result = await setOutboundSecret(id, ctx.restaurantId, secret, ctx.userId)
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 422 })
    }

    return NextResponse.json({ last4: result.last4, updatedAt: result.updatedAt })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }
    console.error('Outbound secret PUT error:', error)
    return NextResponse.json({ error: 'Failed to save secret' }, { status: 500 })
  }
}
