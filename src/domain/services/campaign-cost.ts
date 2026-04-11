/** WhatsApp marketing message rate for Hong Kong (USD per message) */
export const HK_MARKETING_RATE = 0.0732

/** Approximate USD → HKD exchange rate (pegged ~7.8) */
export const USD_TO_HKD = 7.8

/** Convert a USD amount to HKD */
export function toHKD(usd: number): number {
  return Math.round(usd * USD_TO_HKD * 100) / 100
}

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
