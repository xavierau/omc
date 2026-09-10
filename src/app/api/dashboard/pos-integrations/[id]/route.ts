import { NextRequest, NextResponse } from 'next/server'
import { getIntegration, updateIntegration, deleteIntegration } from '@/application/configure-pos-integration'
import { toPublicIntegration } from '@/application/dtos/public-integration'
import { parseIntegrationPatch } from '@/infrastructure/validation/integration-validators'
import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { requireTenantAdmin } from '@/infrastructure/supabase/guards/require-tenant-admin'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const { restaurantId } = await getTenantContext()
    const { id } = await context.params
    const integration = await getIntegration(id, restaurantId)

    if (!integration) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    return NextResponse.json({ data: toPublicIntegration(integration) })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }
    console.error('POS integration detail error:', error)
    return NextResponse.json({ error: 'Failed to load integration' }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const ctx = await getTenantContext()
    requireTenantAdmin(ctx)
    const { id } = await context.params
    const integration = await getIntegration(id, ctx.restaurantId)

    if (!integration) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const body = await request.json()
    const parsed = parseIntegrationPatch(body)
    if (!parsed.ok) {
      const responseBody: Record<string, unknown> = { error: parsed.error }
      if (parsed.error === 'unknown_field') responseBody.field = parsed.field
      return NextResponse.json(responseBody, { status: 400 })
    }

    await updateIntegration(id, ctx.restaurantId, parsed.data)
    return NextResponse.json({ status: 'ok' })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }
    const message = error instanceof Error ? error.message : 'Failed to update integration'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}

export async function DELETE(_request: NextRequest, context: RouteContext) {
  try {
    const ctx = await getTenantContext()
    requireTenantAdmin(ctx)
    const { id } = await context.params
    const integration = await getIntegration(id, ctx.restaurantId)

    if (!integration) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    await deleteIntegration(id, ctx.restaurantId)
    return NextResponse.json({ status: 'ok' })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }
    console.error('POS integration delete error:', error)
    return NextResponse.json({ error: 'Failed to delete integration' }, { status: 500 })
  }
}
