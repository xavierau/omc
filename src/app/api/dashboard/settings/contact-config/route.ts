import { NextRequest, NextResponse } from 'next/server'
import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { updateContactConfig } from '@/infrastructure/supabase/repositories/restaurant-repository'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'
import { validateContactConfig } from '@/domain/services/contact-config'

export async function PATCH(request: NextRequest) {
  try {
    // Tenant scoping is app-layer: the restaurant id comes from the
    // authenticated session, never from the client-supplied body.
    const { restaurantId } = await getTenantContext()
    const body = await request.json()

    const result = validateContactConfig(body)
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 })
    }

    await updateContactConfig(restaurantId, result.config)

    return NextResponse.json({ success: true })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }
    console.error('Contact config update error:', error)
    return NextResponse.json(
      { error: 'Failed to update contact config' },
      { status: 500 }
    )
  }
}
