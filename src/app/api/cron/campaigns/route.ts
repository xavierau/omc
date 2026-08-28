import { NextRequest, NextResponse } from 'next/server'
import {
  getDueCampaigns,
  claimCampaignForEnqueue,
} from '@/infrastructure/supabase/repositories/campaign-repository'
import { addCampaignJob } from '@/infrastructure/queue/campaign-queue'
import { checkCampaignGuardrails } from '@/application/check-campaign-guardrails'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const campaigns = await getDueCampaigns()
    let enqueued = 0
    let skipped = 0
    let throttled = 0

    for (const campaign of campaigns) {
      const canSend = await isGuardrailAllowed(campaign.restaurantId)
      if (!canSend) {
        skipped++
        continue
      }
      // Lease before enqueue, never after: a crash between the two would
      // otherwise leave the campaign unleased and re-enqueued next tick.
      // Losing the race means another tick already has a job in flight.
      const claimed = await claimCampaignForEnqueue(campaign.id)
      if (!claimed) {
        throttled++
        continue
      }
      await addCampaignJob({
        campaignId: campaign.id,
        restaurantId: campaign.restaurantId,
      })
      enqueued++
    }

    return NextResponse.json({ enqueued, skipped, throttled })
  } catch (error) {
    console.error('[Cron] Campaign scheduling error:', error)
    return NextResponse.json(
      { error: 'Failed to schedule campaigns' },
      { status: 500 }
    )
  }
}

/**
 * Optimistic enqueue: passes targetMemberCount=0 because the exact member
 * count is unknown at cron time. This still catches pause, daily-limit, and
 * unsubscribe-rate violations. The monthly-limit check runs again at
 * execution time with the real member count.
 */
async function isGuardrailAllowed(restaurantId: string): Promise<boolean> {
  try {
    const result = await checkCampaignGuardrails(restaurantId, 0)
    if (!result.allowed) {
      console.warn(
        `[Cron] Skipping campaigns for ${restaurantId}: ${result.violations.join('; ')}`
      )
    }
    return result.allowed
  } catch (error) {
    console.error(`[Cron] Guardrail check failed for ${restaurantId}:`, error)
    return false
  }
}
