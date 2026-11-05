import type { TenantPlan } from '@/domain/value-objects/tenant-plan'
import { planCampaignQuota } from '@/domain/value-objects/tenant-plan'
import { updateRestaurantPlan } from '@/infrastructure/supabase/repositories/restaurant-repository'
import { upsertSettings } from '@/infrastructure/supabase/repositories/campaign-settings-repository'

export async function changeTenantPlan(
  restaurantId: string,
  plan: TenantPlan
): Promise<void> {
  const quota = planCampaignQuota(plan)

  // Update plan name first (cheaper, less likely to fail)
  await updateRestaurantPlan(restaurantId, plan)

  try {
    // Then update the quota that actually enforces the limit
    await upsertSettings(restaurantId, { monthlySendLimit: quota })
  } catch (error) {
    // Rollback plan name if quota update fails
    await updateRestaurantPlan(restaurantId, 'starter').catch(() => {})
    const msg = error instanceof Error ? error.message : 'unknown'
    throw new Error(`Failed to update quota for plan ${plan}: ${msg}`)
  }
}
