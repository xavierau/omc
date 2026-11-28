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

/**
 * WhatsApp UTILITY message rate for Hong Kong (USD per message).
 *
 * UNVERIFIED — confirm against Meta official pricing. The HK utility per-message
 * rate was killed in the competitive-analysis review, so this is a placeholder
 * CONFIG value, never a confident HK figure. Correct it in ONE place when Meta
 * pricing is confirmed (plan §7 / R-RATE).
 *
 * NOTE: stamp confirmations / reward-unlocked messages are utility sends. The
 * 「我的會員碼」 keyword deliberately opens the 24h service window so that visit's
 * transactional messages cost 0 (see `estimateUtilityCost` in-window branch).
 */
export const STAMP_UTILITY_RATE_USD = 0.0

/**
 * Estimate the cost of `count` UTILITY sends. In-window utility sends are free
 * (returns 0); out-of-window sends cost `count * STAMP_UTILITY_RATE_USD`. Pure.
 */
export function estimateUtilityCost(
  count: number,
  opts: { withinWindow: boolean }
): number {
  if (opts.withinWindow) return 0
  return Math.round(count * STAMP_UTILITY_RATE_USD * 10000) / 10000
}
