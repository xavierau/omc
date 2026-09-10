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
import { getRestaurantPlan } from '@/infrastructure/supabase/repositories/restaurant-repository'
import { planCampaignQuota } from '@/domain/value-objects/tenant-plan'

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
  const limits = computeEffectiveLimits(settings)
  const violations = collectViolations({
    settings, monthlySends, targetCount: targetMemberCount, dailyCount,
    unsubStats, ...limits,
  })
  return {
    allowed: violations.length === 0,
    violations,
    warnings: collectWarnings(monthlySends, limits.effectiveMonthly),
    usage: buildUsageView({ settings, monthlySends, dailyCount, unsubStats, limits }),
  }
}

interface EffectiveLimits {
  effectiveDaily: number
  effectiveMonthly: number
}

// WAQ-009: stored values are NEVER mutated by auto-throttle; we compute
// the effective bound at read time so undoing a throttle is one column
// write rather than a value backfill.
function computeEffectiveLimits(s: TenantCampaignSettings): EffectiveLimits {
  return {
    effectiveDaily: Math.floor(s.dailyCampaignLimit * s.autoThrottleFactor),
    effectiveMonthly: Math.floor(s.monthlySendLimit * s.autoThrottleFactor),
  }
}

interface UsageInput {
  settings: TenantCampaignSettings
  monthlySends: number
  dailyCount: number
  unsubStats: { total: number; unsubscribed: number }
  limits: EffectiveLimits
}

function buildUsageView(input: UsageInput): GuardrailUsage {
  const { settings, monthlySends, dailyCount, unsubStats, limits } = input
  const unsubRate = unsubStats.total > 0
    ? unsubStats.unsubscribed / unsubStats.total
    : 0
  return {
    monthlySends,
    monthlyLimit: limits.effectiveMonthly,
    dailyCampaigns: dailyCount,
    dailyLimit: limits.effectiveDaily,
    unsubscribeRate: unsubRate,
    maxUnsubscribeRate: settings.maxUnsubscribeRate,
    autoThrottleFactor: settings.autoThrottleFactor,
    autoPauseActive: settings.autoPauseActive,
  }
}

// #161 (CAMP-012): a missing row must degrade to the tenant's ACTUAL plan
// quota, not the hardcoded starter default -- and the degradation must be
// observable (a missing row after migration 078 means something deleted
// it). A throwing plan read propagates (fail-closed, D3): the existing
// `getSettingsForTenant` throw path already fails the campaign rather than
// silently allowing it.
async function resolveSettings(
  restaurantId: string
): Promise<TenantCampaignSettings> {
  const row = await getSettingsForTenant(restaurantId)
  if (row) return row
  return planDerivedDefaults(restaurantId)
}

// Exported because the platform-admin campaign-settings view has the SAME
// null-settings fallback, and a view that reports a different quota from the
// one the worker enforces is worse than no view: an admin "correcting" the
// number PUTs a real row at the wrong limit (review F2).
export async function planDerivedDefaults(
  restaurantId: string
): Promise<TenantCampaignSettings> {
  const plan = (await getRestaurantPlan(restaurantId)) ?? 'starter'
  const monthlySendLimit = planCampaignQuota(plan)
  console.warn(
    `[Guardrails] tenant_campaign_settings missing for tenant ${restaurantId}; using plan-derived defaults (plan=${plan}, monthlySendLimit=${monthlySendLimit}) — migration 078 should have seeded this row`
  )
  return { restaurantId, ...DEFAULT_SETTINGS, monthlySendLimit }
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
