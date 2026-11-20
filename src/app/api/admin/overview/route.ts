import { NextResponse } from 'next/server'
import { assertPlatformAdmin } from '@/infrastructure/supabase/guards/platform-admin-guard'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'
import { getPlatformOverview } from '@/application/get-platform-overview'
import { checkAdminRateLimit } from '@/infrastructure/rate-limit/admin-rate-limit'

export async function GET() {
  try {
    const { userId } = await assertPlatformAdmin()
    if (!checkAdminRateLimit(userId).success) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }
    const overview = await getPlatformOverview()
    return NextResponse.json(overview)
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }
    console.error('Platform overview error:', error)
    return NextResponse.json(
      { error: 'Failed to load platform overview' },
      { status: 500 }
    )
  }
}
