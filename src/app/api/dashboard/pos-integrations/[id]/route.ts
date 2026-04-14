import { NextRequest, NextResponse } from 'next/server'
import { getIntegration, updateIntegration, deleteIntegration } from '@/application/configure-pos-integration'
import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const { restaurantId } = await getTenantContext()
    const { id } = await context.params
    const integration = await getIntegration(id)

    if (!integration || integration.restaurantId !== restaurantId) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    return NextResponse.json({ data: integration })
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
    const { restaurantId } = await getTenantContext()
    const { id } = await context.params
    const integration = await getIntegration(id)

    if (!integration || integration.restaurantId !== restaurantId) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const body = await request.json()
    await updateIntegration(id, body)
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
    const { restaurantId } = await getTenantContext()
    const { id } = await context.params
    const integration = await getIntegration(id)

    if (!integration || integration.restaurantId !== restaurantId) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    await deleteIntegration(id)
    return NextResponse.json({ status: 'ok' })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }
    console.error('POS integration delete error:', error)
    return NextResponse.json({ error: 'Failed to delete integration' }, { status: 500 })
  }
}
