export interface GuardrailResult {
  allowed: boolean
  reason?: string
}

export interface TenantCampaignSettings {
  restaurantId: string
  monthlySendLimit: number
  dailyCampaignLimit: number
  maxUnsubscribeRate: number
  campaignPaused: boolean
  pausedReason?: string | null
  pausedAt?: Date | null
}

export const DEFAULT_SETTINGS: Omit<TenantCampaignSettings, 'restaurantId'> = {
  monthlySendLimit: 1000,
  dailyCampaignLimit: 1,
  maxUnsubscribeRate: 0.05,
  campaignPaused: false,
}

export function checkMonthlyLimit(
  currentMonthSends: number,
  targetMemberCount: number,
  monthlyLimit: number
): GuardrailResult {
  if (currentMonthSends + targetMemberCount >= monthlyLimit) {
    return {
      allowed: false,
      reason: `Monthly send limit reached: ${currentMonthSends}/${monthlyLimit} used, target ${targetMemberCount}`,
    }
  }
  return { allowed: true }
}

export function checkUnsubscribeRate(
  totalMembers: number,
  unsubscribedMembers: number,
  maxRate: number
): GuardrailResult {
  if (totalMembers === 0) return { allowed: true }
  const rate = unsubscribedMembers / totalMembers
  if (rate >= maxRate) {
    return {
      allowed: false,
      reason: `Unsubscribe rate ${(rate * 100).toFixed(1)}% exceeds max ${(maxRate * 100).toFixed(1)}%`,
    }
  }
  return { allowed: true }
}

export function checkDailyFrequency(
  campaignsExecutedToday: number,
  dailyLimit: number
): GuardrailResult {
  if (campaignsExecutedToday >= dailyLimit) {
    return {
      allowed: false,
      reason: `Daily campaign limit reached: ${campaignsExecutedToday}/${dailyLimit}`,
    }
  }
  return { allowed: true }
}

export function checkCampaignPaused(
  paused: boolean,
  reason?: string | null
): GuardrailResult {
  if (!paused) return { allowed: true }
  return {
    allowed: false,
    reason: `Campaigns paused${reason ? `: ${reason}` : ''}`,
  }
}

export function isApproachingLimit(
  currentMonthSends: number,
  monthlyLimit: number,
  threshold = 0.8
): boolean {
  if (monthlyLimit === 0) return true
  return currentMonthSends / monthlyLimit >= threshold
}
