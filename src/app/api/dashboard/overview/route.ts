import { NextResponse } from 'next/server'
import { getDashboardOverview } from '@/application/get-dashboard-overview'
import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'

export async function GET() {
  try {
    const { restaurantId } = await getTenantContext()
    const overview = await getDashboardOverview(restaurantId)
    return NextResponse.json(overview)
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }
    console.error('Dashboard overview error:', error)
    return NextResponse.json(
      { error: 'Failed to load dashboard overview' },
      { status: 500 }
    )
  }
}
