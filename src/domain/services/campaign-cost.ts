/** WhatsApp marketing message rate for Hong Kong (USD per message) */
export const HK_MARKETING_RATE = 0.0732

export interface CampaignUsageSummary {
  campaignId: string
  campaignName: string
  category: 'marketing'
  sentCount: number
  estimatedCost: number
  executedAt: string
}

export interface MonthlyUsageSummary {
  month: string
  totalSent: number
  totalEstimatedCost: number
  campaigns: CampaignUsageSummary[]
}

/** Estimate the cost of sending `count` marketing messages in HK */
export function estimateCampaignCost(count: number): number {
  return Math.round(count * HK_MARKETING_RATE * 10000) / 10000
}
