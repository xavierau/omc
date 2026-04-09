import { NextRequest, NextResponse } from 'next/server'
import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { updateLogoUrl } from '@/infrastructure/supabase/repositories/restaurant-repository'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'

export async function PATCH(request: NextRequest) {
  try {
    const { restaurantId } = await getTenantContext()
    const body = await request.json()
    const logoUrl = typeof body.logoUrl === 'string' ? body.logoUrl : null

    await updateLogoUrl(restaurantId, logoUrl)

    return NextResponse.json({ success: true })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }
    console.error('Logo update error:', error)
    return NextResponse.json({ error: 'Failed to update logo' }, { status: 500 })
  }
}
