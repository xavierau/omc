import { NextRequest, NextResponse } from 'next/server'
import { createIntegration, listIntegrations } from '@/application/configure-pos-integration'
import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'

export async function GET() {
  try {
    const { restaurantId } = await getTenantContext()
    const integrations = await listIntegrations(restaurantId)
    return NextResponse.json({ data: integrations })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }
    console.error('POS integrations list error:', error)
    return NextResponse.json({ error: 'Failed to load integrations' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const { restaurantId } = await getTenantContext()
    const body = await request.json()

    if (!body.name) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 })
    }

    const result = await createIntegration({
      restaurantId,
      provider: body.provider,
      name: body.name,
      fieldMapping: body.fieldMapping,
      credentials: body.credentials,
    })

    return NextResponse.json({ data: result }, { status: 201 })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }
    console.error('POS integration create error:', error)
    return NextResponse.json({ error: 'Failed to create integration' }, { status: 500 })
  }
}
