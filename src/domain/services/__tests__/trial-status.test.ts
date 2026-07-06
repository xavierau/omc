import { describe, it, expect } from 'vitest'
import { isTrialExpired, isTenantAccessible } from '../trial-status'
import type { Restaurant } from '@/domain/entities/restaurant'

function makeRestaurant(
  overrides: Partial<Restaurant> = {}
): Restaurant {
  return {
    id: 'r-1',
    name: 'Test',
    slug: 'test',
    whatsappNumber: '',
    kapsoPhoneNumberId: null,
    metaBusinessAccountId: null,
    status: 'active',
    plan: 'starter',
    trialExpiresAt: null,
    referrerId: null,
    redirectNumber: null,
    redirectLabel: 'Contact us',
    createdAt: '2024-01-01T00:00:00Z',
    ...overrides,
  }
}

describe('isTrialExpired', () => {
  it('returns false for active status', () => {
    expect(isTrialExpired(makeRestaurant({ status: 'active' }))).toBe(false)
  })

  it('returns false for inactive status', () => {
    expect(isTrialExpired(makeRestaurant({ status: 'inactive' }))).toBe(false)
  })

  it('returns true for trial with no expiry date', () => {
    expect(isTrialExpired(makeRestaurant({ status: 'trial', trialExpiresAt: null }))).toBe(true)
  })

  it('returns true for trial with past expiry', () => {
    const past = new Date(Date.now() - 86400000).toISOString()
    expect(isTrialExpired(makeRestaurant({ status: 'trial', trialExpiresAt: past }))).toBe(true)
  })

  it('returns false for trial with future expiry', () => {
    const future = new Date(Date.now() + 86400000).toISOString()
    expect(isTrialExpired(makeRestaurant({ status: 'trial', trialExpiresAt: future }))).toBe(false)
  })
})

describe('isTenantAccessible', () => {
  it('returns true for active tenants', () => {
    expect(isTenantAccessible(makeRestaurant({ status: 'active' }))).toBe(true)
  })

  it('returns false for inactive tenants', () => {
    expect(isTenantAccessible(makeRestaurant({ status: 'inactive' }))).toBe(false)
  })

  it('returns true for trial with future expiry', () => {
    const future = new Date(Date.now() + 86400000).toISOString()
    expect(isTenantAccessible(makeRestaurant({ status: 'trial', trialExpiresAt: future }))).toBe(true)
  })

  it('returns false for trial with past expiry', () => {
    const past = new Date(Date.now() - 86400000).toISOString()
    expect(isTenantAccessible(makeRestaurant({ status: 'trial', trialExpiresAt: past }))).toBe(false)
  })

  // All branches are covered by existing tests:
  // - isTrialExpired: active/inactive return false, trial+null/past/future all tested
  // - isTenantAccessible: active (true), inactive (false), trial+future (true), trial+past (false)
  // No additional scenarios needed.
})
