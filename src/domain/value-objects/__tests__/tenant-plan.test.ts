import { describe, it, expect } from 'vitest'
import {
  planCampaignQuota,
  isValidPlan,
  type TenantPlan,
} from '@/domain/value-objects/tenant-plan'
import { DEFAULT_SETTINGS } from '@/domain/services/campaign-guardrails'

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

// #161 A2: ties the hardcoded DEFAULT_SETTINGS fallback constant to the VO
// so a future quota change to 'starter' cannot drift the two apart silently.
describe('DEFAULT_SETTINGS.monthlySendLimit parity', () => {
  it('equals planCampaignQuota("starter")', () => {
    expect(DEFAULT_SETTINGS.monthlySendLimit).toBe(planCampaignQuota('starter'))
  })
})
