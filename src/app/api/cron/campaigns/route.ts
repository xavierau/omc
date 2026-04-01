import { NextRequest, NextResponse } from 'next/server'
import { getDueCampaigns } from '@/infrastructure/supabase/repositories/campaign-repository'
import { addCampaignJob } from '@/infrastructure/queue/campaign-queue'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const campaigns = await getDueCampaigns()

    for (const campaign of campaigns) {
      await addCampaignJob({
        campaignId: campaign.id,
        restaurantId: campaign.restaurantId,
      })
    }

    return NextResponse.json({ enqueued: campaigns.length })
  } catch (error) {
    console.error('[Cron] Campaign scheduling error:', error)
    return NextResponse.json(
      { error: 'Failed to schedule campaigns' },
      { status: 500 }
    )
  }
}
