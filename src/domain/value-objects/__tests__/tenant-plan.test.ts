import { describe, it, expect } from 'vitest'
import {
  planCampaignQuota,
  isValidPlan,
  type TenantPlan,
} from '@/domain/value-objects/tenant-plan'

describe('planCampaignQuota', () => {
  it('returns 1000 for starter', () => {
    expect(planCampaignQuota('starter')).toBe(1000)
  })

  it('returns 10000 for growth', () => {
    expect(planCampaignQuota('growth')).toBe(10000)
  })

  it('returns 100000 for pro', () => {
    expect(planCampaignQuota('pro')).toBe(100000)
  })
})

describe('isValidPlan', () => {
  it.each(['starter', 'growth', 'pro'])('returns true for "%s"', (plan) => {
    expect(isValidPlan(plan)).toBe(true)
  })

  it.each(['free', 'enterprise', '', 'Starter', 'GROWTH'])(
    'returns false for "%s"',
    (value) => {
      expect(isValidPlan(value)).toBe(false)
    }
  )
})
