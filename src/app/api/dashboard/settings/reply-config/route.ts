import { NextRequest, NextResponse } from 'next/server'
import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { updateReplyConfig } from '@/infrastructure/supabase/repositories/restaurant-repository'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'
import { validateReplyConfig } from '@/domain/services/reply-config'

export async function PATCH(request: NextRequest) {
  try {
    // Tenant scoping is app-layer: the restaurant id comes from the
    // authenticated session, never from the client-supplied body.
    const { restaurantId } = await getTenantContext()
    const body = await request.json()

    const result = validateReplyConfig(body)
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 })
    }

    await updateReplyConfig(restaurantId, result.config)

    return NextResponse.json({ success: true })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }
    console.error('Reply config update error:', error)
    return NextResponse.json(
      { error: 'Failed to update reply config' },
      { status: 500 }
    )
  }
}
