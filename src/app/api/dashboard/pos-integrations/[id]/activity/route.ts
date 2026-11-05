import { NextRequest, NextResponse } from 'next/server'
import { getIntegration } from '@/application/configure-pos-integration'
import { listIntegrationActivity } from '@/application/list-integration-activity'
import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { requireTenantAdmin } from '@/infrastructure/supabase/guards/require-tenant-admin'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const ctx = await getTenantContext()
    requireTenantAdmin(ctx)
    const { id } = await context.params
    const integration = await getIntegration(id, ctx.restaurantId)
    if (!integration) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const cursor = request.nextUrl.searchParams.get('cursor') ?? undefined
    const result = await listIntegrationActivity(id, ctx.restaurantId, { cursor })
    return NextResponse.json({ data: result.data, nextCursor: result.nextCursor })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }
    console.error('Integration activity GET error:', error)
    return NextResponse.json({ error: 'Failed to load activity' }, { status: 500 })
  }
}
