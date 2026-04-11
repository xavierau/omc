import { getCampaignsForTenantMonth } from '@/infrastructure/supabase/repositories/campaign-usage-repository'
import {
  estimateCampaignCost,
  type MonthlyUsageSummary,
  type CampaignUsageSummary,
} from '@/domain/services/campaign-cost'
import type { Campaign } from '@/domain/entities/campaign'

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

function currentMonth(): string {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  return `${y}-${m}`
}

function parseMonthRange(month: string) {
  const [year, mon] = month.split('-').map(Number)
  const start = new Date(Date.UTC(year, mon - 1, 1))
  const end = new Date(Date.UTC(year, mon, 1))
  return {
    monthStart: start.toISOString(),
    monthEnd: end.toISOString(),
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
