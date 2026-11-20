import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/infrastructure/supabase/repositories/restaurant-repository')
vi.mock('@/infrastructure/supabase/repositories/campaign-settings-repository')

import { updateRestaurantPlan } from '@/infrastructure/supabase/repositories/restaurant-repository'
import { upsertSettings } from '@/infrastructure/supabase/repositories/campaign-settings-repository'
import { changeTenantPlan } from '../change-tenant-plan'

describe('changeTenantPlan', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(updateRestaurantPlan).mockResolvedValue(undefined)
    vi.mocked(upsertSettings).mockResolvedValue({} as never)
  })

  it('updates restaurant plan to starter with quota 1000', async () => {
    await changeTenantPlan('rest-1', 'starter')

    expect(updateRestaurantPlan).toHaveBeenCalledWith('rest-1', 'starter')
    expect(upsertSettings).toHaveBeenCalledWith('rest-1', {
      monthlySendLimit: 1000,
    })
  })

  it('updates restaurant plan to growth with quota 10000', async () => {
    await changeTenantPlan('rest-1', 'growth')

    expect(updateRestaurantPlan).toHaveBeenCalledWith('rest-1', 'growth')
    expect(upsertSettings).toHaveBeenCalledWith('rest-1', {
      monthlySendLimit: 10000,
    })
  })

  it('updates restaurant plan to pro with quota 100000', async () => {
    await changeTenantPlan('rest-1', 'pro')

    expect(updateRestaurantPlan).toHaveBeenCalledWith('rest-1', 'pro')
    expect(upsertSettings).toHaveBeenCalledWith('rest-1', {
      monthlySendLimit: 100000,
    })
  })
})
