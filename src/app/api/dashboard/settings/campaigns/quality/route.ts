/**
 * CAMP-016: member quality distribution for the Settings → Campaigns bar.
 * Every active member of the session's tenant, no lapsed filter, no skip:
 * counted by the same SQL that rates recipients at send time. Aggregates
 * only (R2); any tenant member may read it.
 */
import { NextResponse } from 'next/server'
import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'
import { countAudience } from '@/infrastructure/supabase/repositories/campaign-audience-repository'
import { audienceQueryForPreview } from '@/application/campaign-audience-query'

export async function GET() {
  try {
    const { restaurantId } = await getTenantContext()
    const c = await countAudience(
      audienceQueryForPreview({ restaurantId, audience: 'all', tagIds: [], memberIds: [], lapsedDays: null, skip: 'off' })
    )
    return NextResponse.json({ total: c.audience, green: c.green, yellow: c.yellow, red: c.red, noData: c.noData })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }
    console.error('[CampaignSettings] quality read failed:', (error as Error).message)
    return NextResponse.json({ error: 'Failed to load member quality' }, { status: 500 })
  }
}
