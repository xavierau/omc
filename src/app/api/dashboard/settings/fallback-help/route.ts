import { NextRequest, NextResponse } from 'next/server'
import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { updateFallbackHelpEnabled } from '@/infrastructure/supabase/repositories/restaurant-repository'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'

export async function PATCH(request: NextRequest) {
  try {
    // Tenant scoping is app-layer: the restaurant id comes from the
    // authenticated session, never from the client-supplied body.
    const { restaurantId } = await getTenantContext()
    const body = await request.json()
    if (typeof body.helpEnabled !== 'boolean') {
      return NextResponse.json(
        { error: 'helpEnabled must be a boolean' },
        { status: 400 }
      )
    }

    await updateFallbackHelpEnabled(restaurantId, body.helpEnabled)

    return NextResponse.json({ success: true })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }
    console.error('Fallback help toggle update error:', error)
    return NextResponse.json(
      { error: 'Failed to update fallback help toggle' },
      { status: 500 }
    )
  }
}
