import {
  checkMonthlyLimit,
  checkUnsubscribeRate,
  checkDailyFrequency,
  checkCampaignPaused,
  isApproachingLimit,
  DEFAULT_SETTINGS,
} from '@/domain/services/campaign-guardrails'
import type { TenantCampaignSettings } from '@/domain/services/campaign-guardrails'
import {
  getSettingsForTenant,
  getMonthlyTenantSends,
  getTodayCampaignCount,
  getUnsubscribeStats,
} from '@/infrastructure/supabase/repositories/campaign-settings-repository'

export interface GuardrailUsage {
  monthlySends: number
  monthlyLimit: number
  dailyCampaigns: number
  dailyLimit: number
  unsubscribeRate: number
  maxUnsubscribeRate: number
}

export interface GuardrailCheckResult {
  allowed: boolean
  violations: string[]
  warnings: string[]
  usage: GuardrailUsage
}

export async function checkCampaignGuardrails(
  restaurantId: string,
  targetMemberCount: number
): Promise<GuardrailCheckResult> {
  const settings = await resolveSettings(restaurantId)
  const [monthlySends, dailyCount, unsubStats] = await fetchStats(restaurantId)

  const violations = collectViolations(
    settings, monthlySends, targetMemberCount, dailyCount, unsubStats
  )
  const warnings = collectWarnings(monthlySends, settings.monthlySendLimit)
  const unsubRate = unsubStats.total > 0
    ? unsubStats.unsubscribed / unsubStats.total
    : 0

  return {
    allowed: violations.length === 0,
    violations,
    warnings,
    usage: {
      monthlySends,
      monthlyLimit: settings.monthlySendLimit,
      dailyCampaigns: dailyCount,
      dailyLimit: settings.dailyCampaignLimit,
      unsubscribeRate: unsubRate,
      maxUnsubscribeRate: settings.maxUnsubscribeRate,
    },
  }
}

async function resolveSettings(
  restaurantId: string
): Promise<TenantCampaignSettings> {
  const row = await getSettingsForTenant(restaurantId)
  if (row) return row
  return { restaurantId, ...DEFAULT_SETTINGS }
}

function fetchStats(restaurantId: string) {
  return Promise.all([
    getMonthlyTenantSends(restaurantId),
    getTodayCampaignCount(restaurantId),
    getUnsubscribeStats(restaurantId),
  ])
}

function collectViolations(
  settings: TenantCampaignSettings,
  monthlySends: number,
  targetCount: number,
  dailyCount: number,
  unsubStats: { total: number; unsubscribed: number }
): string[] {
  const checks = [
    checkMonthlyLimit(monthlySends, targetCount, settings.monthlySendLimit),
    checkUnsubscribeRate(
      unsubStats.total, unsubStats.unsubscribed, settings.maxUnsubscribeRate
    ),
    checkDailyFrequency(dailyCount, settings.dailyCampaignLimit),
    checkCampaignPaused(settings.campaignPaused, settings.pausedReason),
  ]
  return checks
    .filter((r) => !r.allowed)
    .map((r) => r.reason!)
}

function collectWarnings(
  monthlySends: number,
  monthlyLimit: number
): string[] {
  if (isApproachingLimit(monthlySends, monthlyLimit)) {
    return [
      `You are approaching your monthly send limit (${monthlySends}/${monthlyLimit})`,
    ]
  }
  return []
}
