import { NextResponse } from 'next/server'
import { getDashboardOverview } from '@/application/get-dashboard-overview'
import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'
import { createServerSupabaseClient } from '@/infrastructure/supabase/client'

export async function GET() {
  try {
    const { restaurantId } = await getTenantContext()
    const [overview, restaurant] = await Promise.all([
      getDashboardOverview(restaurantId),
      fetchKapsoPhoneNumberId(restaurantId),
    ])
    return NextResponse.json({
      ...overview,
      kapsoPhoneNumberId: restaurant,
    })
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

async function fetchKapsoPhoneNumberId(
  restaurantId: string
): Promise<string | null> {
  const supabase = createServerSupabaseClient()
  const { data } = await supabase
    .from('restaurants')
    .select('kapso_phone_number_id')
    .eq('id', restaurantId)
    .single()
  return data?.kapso_phone_number_id ?? null
}
