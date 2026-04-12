import { describe, it, expect } from 'vitest'
import { assessTamperRisk, isMerchantMatch } from '../receipt-validation'
import type { ParsedReceipt } from '@/domain/interfaces/parsed-receipt'

function buildReceipt(
  overrides: Partial<ParsedReceipt> = {}
): ParsedReceipt {
  return {
    total: 100,
    items: [{ name: 'Item A', price: 80 }, { name: 'Item B', price: 20 }],
    confidence: 0.95,
    currency: 'HKD',
    receiptNumber: null,
    merchantName: null,
    tamperAssessment: null,
    ...overrides,
  }
}

describe('assessTamperRisk', () => {
  it('returns not suspicious when items sum matches total', () => {
    const receipt = buildReceipt({
      total: 100,
      items: [{ name: 'A', price: 50 }, { name: 'B', price: 50 }],
    })
    const result = assessTamperRisk(receipt)
    expect(result.isSuspicious).toBe(false)
    expect(result.reasons).toEqual([])
  })

  it('flags suspicious when items sum diverges >20%', () => {
    const receipt = buildReceipt({
      total: 200,
      items: [{ name: 'A', price: 50 }],
    })
    const result = assessTamperRisk(receipt)
    expect(result.isSuspicious).toBe(true)
    expect(result.reasons.length).toBeGreaterThan(0)
  })

  it('includes AI tamper reasons when flagged', () => {
    const receipt = buildReceipt({
      tamperAssessment: {
        isSuspicious: true,
        reasons: ['Inconsistent fonts detected'],
      },
    })
    const result = assessTamperRisk(receipt)
    expect(result.isSuspicious).toBe(true)
    expect(result.reasons).toContain('Inconsistent fonts detected')
  })

  it('returns not suspicious for empty items list', () => {
    const receipt = buildReceipt({ total: 100, items: [] })
    const result = assessTamperRisk(receipt)
    expect(result.isSuspicious).toBe(false)
  })

  it('returns not suspicious when divergence is exactly 20%', () => {
    const receipt = buildReceipt({
      total: 100,
      items: [{ name: 'A', price: 80 }],
    })
    const result = assessTamperRisk(receipt)
    expect(result.isSuspicious).toBe(false)
    expect(result.reasons).toEqual([])
  })

  it('flags suspicious when divergence is 21%', () => {
    const receipt = buildReceipt({
      total: 100,
      items: [{ name: 'A', price: 79 }],
    })
    const result = assessTamperRisk(receipt)
    expect(result.isSuspicious).toBe(true)
    expect(result.reasons.length).toBeGreaterThan(0)
  })
})

describe('isMerchantMatch', () => {
  it('returns true for exact match', () => {
    expect(isMerchantMatch('Burger King', ['Burger King'])).toBe(true)
  })

  it('returns true for case-insensitive match', () => {
    expect(isMerchantMatch('BURGER KING', ['burger king'])).toBe(true)
  })

  it('returns true for substring match', () => {
    expect(isMerchantMatch('Burger King HK Ltd', ['Burger King'])).toBe(true)
  })

  it('returns true for Chinese characters match', () => {
    expect(isMerchantMatch('好味道餐廳', ['好味道餐廳'])).toBe(true)
  })

  it('returns true for mixed EN/ZH match', () => {
    expect(
      isMerchantMatch('好味道 Good Taste Restaurant', ['好味道'])
    ).toBe(true)
  })

  it('returns false when no match', () => {
    expect(isMerchantMatch('Pizza Hut', ['Burger King'])).toBe(false)
  })

  it('returns true when merchant name is null', () => {
    expect(isMerchantMatch(null, ['Burger King'])).toBe(true)
  })

  it('returns true when merchant name is empty', () => {
    expect(isMerchantMatch('', ['Burger King'])).toBe(true)
  })
})
