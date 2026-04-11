import type { TenantPlan } from '@/domain/value-objects/tenant-plan'
import { planCampaignQuota } from '@/domain/value-objects/tenant-plan'
import { updateRestaurantPlan } from '@/infrastructure/supabase/repositories/restaurant-repository'
import { upsertSettings } from '@/infrastructure/supabase/repositories/campaign-settings-repository'

export async function changeTenantPlan(
  restaurantId: string,
  plan: TenantPlan
): Promise<void> {
  try {
    await upsertSettings(restaurantId, {
      monthlySendLimit: planCampaignQuota(plan),
    })
    await updateRestaurantPlan(restaurantId, plan)
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'unknown'
    throw new Error(`Failed to change plan to ${plan}: ${msg}`)
  }
}
