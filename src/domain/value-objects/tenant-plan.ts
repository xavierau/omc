export type TenantPlan = 'starter' | 'growth' | 'pro'

const PLAN_QUOTAS: Record<TenantPlan, number> = {
  starter: 1_000,
  growth: 10_000,
  pro: 100_000,
}

const VALID_PLANS = new Set<string>(Object.keys(PLAN_QUOTAS))

export function planCampaignQuota(plan: TenantPlan): number {
  return PLAN_QUOTAS[plan]
}

export function isValidPlan(value: string): value is TenantPlan {
  return VALID_PLANS.has(value)
}
