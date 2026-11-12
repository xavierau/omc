import { NextRequest, NextResponse } from 'next/server'
import { syncTemplateStatus } from '@/application/sync-template-status'
import { listActive } from '@/infrastructure/supabase/repositories/restaurant-repository'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const restaurants = await listActive()
    const withWaba = restaurants.filter((r) => r.meta_business_account_id)

    const allResults: Array<{ restaurantId: string; synced: number }> = []

    for (const restaurant of withWaba) {
      const result = await syncTemplateStatus(restaurant.id)
      allResults.push({
        restaurantId: restaurant.id,
        synced: result.updated.length,
      })
    }

    return NextResponse.json({
      restaurants: allResults.length,
      results: allResults,
    })
  } catch (error) {
    console.error('[Cron] Template sync error:', error)
    return NextResponse.json(
      { error: 'Failed to sync templates' },
      { status: 500 }
    )
  }
}
