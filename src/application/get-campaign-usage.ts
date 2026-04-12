import { getCampaignsForTenantMonth } from '@/infrastructure/supabase/repositories/campaign-usage-repository'
import {
  estimateCampaignCost,
  type MonthlyUsageSummary,
  type CampaignUsageSummary,
} from '@/domain/services/campaign-cost'
import type { Campaign } from '@/domain/entities/campaign'
import { currentMonth, parseMonthRange } from '@/lib/month-range'

export async function getCampaignUsage(
  restaurantId: string,
  month?: string
): Promise<MonthlyUsageSummary> {
  const targetMonth = month ?? currentMonth()
  const { monthStart, monthEnd } = parseMonthRange(targetMonth)

  const campaigns = await getCampaignsForTenantMonth(
    restaurantId, monthStart, monthEnd
  )

  const summaries = campaigns.map(toCampaignSummary)
  const totalSent = summaries.reduce((s, c) => s + c.sentCount, 0)
  const totalCost = summaries.reduce((s, c) => s + c.estimatedCost, 0)

  return {
    month: targetMonth,
    totalSent,
    totalEstimatedCost: Math.round(totalCost * 10000) / 10000,
    campaigns: summaries,
  }
}

function toCampaignSummary(c: Campaign): CampaignUsageSummary {
  return {
    campaignId: c.id,
    campaignName: c.name ?? '',
    category: 'marketing' as const,
    sentCount: c.sentCount,
    estimatedCost: estimateCampaignCost(c.sentCount),
    executedAt: c.createdAt,
  }
}
