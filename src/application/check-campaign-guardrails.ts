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
  // WAQ-009: surfaces the runtime modifier so callers can render
  // "throttled to 50%" affordances without re-reading settings.
  autoThrottleFactor: number
  autoPauseActive: boolean
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
  // WAQ-009: stored values are NEVER mutated by auto-throttle; we compute
  // the effective bound at read time so undoing a throttle is one column
  // write rather than a value backfill.
  const effectiveDaily = effectiveLimit(
    settings.dailyCampaignLimit, settings.autoThrottleFactor
  )
  const effectiveMonthly = effectiveLimit(
    settings.monthlySendLimit, settings.autoThrottleFactor
  )

  const violations = collectViolations({
    settings,
    monthlySends, targetCount: targetMemberCount, dailyCount, unsubStats,
    effectiveDaily, effectiveMonthly,
  })
  const warnings = collectWarnings(monthlySends, effectiveMonthly)
  const unsubRate = unsubStats.total > 0
    ? unsubStats.unsubscribed / unsubStats.total
    : 0

  return {
    allowed: violations.length === 0,
    violations,
    warnings,
    usage: {
      monthlySends,
      monthlyLimit: effectiveMonthly,
      dailyCampaigns: dailyCount,
      dailyLimit: effectiveDaily,
      unsubscribeRate: unsubRate,
      maxUnsubscribeRate: settings.maxUnsubscribeRate,
      autoThrottleFactor: settings.autoThrottleFactor,
      autoPauseActive: settings.autoPauseActive,
    },
  }
}

function effectiveLimit(stored: number, factor: number): number {
  return Math.floor(stored * factor)
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

interface ViolationsInput {
  settings: TenantCampaignSettings
  monthlySends: number
  targetCount: number
  dailyCount: number
  unsubStats: { total: number; unsubscribed: number }
  effectiveDaily: number
  effectiveMonthly: number
}

function collectViolations(input: ViolationsInput): string[] {
  const { settings, monthlySends, targetCount, dailyCount, unsubStats } = input
  const checks = [
    checkMonthlyLimit(monthlySends, targetCount, input.effectiveMonthly),
    checkUnsubscribeRate(
      unsubStats.total, unsubStats.unsubscribed, settings.maxUnsubscribeRate
    ),
    checkDailyFrequency(dailyCount, input.effectiveDaily),
    checkCampaignPaused(settings.campaignPaused, settings.pausedReason),
    // WAQ-009: independent gate. Either OR-ed switch denies sends.
    autoPauseCheck(settings),
  ]
  return checks
    .filter((r) => !r.allowed)
    .map((r) => r.reason!)
}

function autoPauseCheck(
  settings: TenantCampaignSettings
): { allowed: boolean; reason?: string } {
  if (!settings.autoPauseActive) return { allowed: true }
  return {
    allowed: false,
    reason: `Campaigns auto-paused by quality monitor${
      settings.autoPauseReason ? `: ${settings.autoPauseReason}` : ''
    }`,
  }
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
