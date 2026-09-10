import { NextRequest, NextResponse } from 'next/server'
import { getIntegration } from '@/application/configure-pos-integration'
import { resumeOutbound } from '@/application/resume-outbound'
import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { requireTenantAdmin } from '@/infrastructure/supabase/guards/require-tenant-admin'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'

type RouteContext = { params: Promise<{ id: string }> }

export async function POST(_request: NextRequest, context: RouteContext) {
  try {
    const ctx = await getTenantContext()
    requireTenantAdmin(ctx)
    const { id } = await context.params
    const integration = await getIntegration(id, ctx.restaurantId)
    if (!integration) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const result = await resumeOutbound(id, ctx.restaurantId)
    if (!result.ok) {
      if (result.error === 'integration_not_found') {
        return NextResponse.json({ error: result.error }, { status: 404 })
      }
      return NextResponse.json({ error: result.error }, { status: 422 })
    }

    return NextResponse.json({ requeued: result.requeued })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }
    console.error('Outbound resume POST error:', error)
    return NextResponse.json({ error: 'Failed to resume deliveries' }, { status: 500 })
  }
}
