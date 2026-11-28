import { describe, it, expect } from 'vitest'
import {
  estimateCampaignCost,
  estimateUtilityCost,
  STAMP_UTILITY_RATE_USD,
  HK_MARKETING_RATE,
  USD_TO_HKD,
  toHKD,
} from '../campaign-cost'

describe('campaign-cost', () => {
  it('HK_MARKETING_RATE equals 0.0732', () => {
    expect(HK_MARKETING_RATE).toBe(0.0732)
  })

  it('estimates cost for 100 messages', () => {
    expect(estimateCampaignCost(100)).toBe(7.32)
  })

  it('returns 0 for zero messages', () => {
    expect(estimateCampaignCost(0)).toBe(0)
  })

  it('returns 0.0732 for a single message', () => {
    expect(estimateCampaignCost(1)).toBe(0.0732)
  })

  it('USD_TO_HKD equals 7.8', () => {
    expect(USD_TO_HKD).toBe(7.8)
  })

  it('converts USD to HKD', () => {
    expect(toHKD(7.32)).toBe(57.1)
  })

  it('converts 0 USD to 0 HKD', () => {
    expect(toHKD(0)).toBe(0)
  })
})

describe('estimateUtilityCost', () => {
  it('is 0 for an in-window utility send (free inside the 24h window)', () => {
    expect(estimateUtilityCost(5, { withinWindow: true })).toBe(0)
  })

  it('is 0 for an in-window send regardless of count', () => {
    expect(estimateUtilityCost(0, { withinWindow: true })).toBe(0)
    expect(estimateUtilityCost(100, { withinWindow: true })).toBe(0)
  })

  it('charges count * the config rate when out of window', () => {
    // Assert against the CONFIG constant, never a hardcoded HK figure — the
    // utility rate is UNVERIFIED and lives in one place to correct.
    expect(estimateUtilityCost(3, { withinWindow: false })).toBe(
      3 * STAMP_UTILITY_RATE_USD
    )
  })

  it('is 0 for zero out-of-window messages', () => {
    expect(estimateUtilityCost(0, { withinWindow: false })).toBe(0)
  })
})
