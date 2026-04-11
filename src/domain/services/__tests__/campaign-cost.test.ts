import { describe, it, expect } from 'vitest'
import {
  estimateCampaignCost,
  HK_MARKETING_RATE,
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
})
