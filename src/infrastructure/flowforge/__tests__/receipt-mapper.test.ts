import { describe, it, expect } from 'vitest'
import { mapFlowForgeResultToReceipt } from '../receipt-mapper'

describe('mapFlowForgeResultToReceipt', () => {
  it('maps valid result with total, items, currency', () => {
    const result = {
      data: {
        total: 256.5,
        currency: 'USD',
        items: [
          { name: 'Burger', price: 120 },
          { name: 'Fries', price: 45 },
        ],
      },
    }

    const parsed = mapFlowForgeResultToReceipt(result)

    expect(parsed.total).toBe(256.5)
    expect(parsed.currency).toBe('USD')
    expect(parsed.items).toEqual([
      { name: 'Burger', price: 120 },
      { name: 'Fries', price: 45 },
    ])
    expect(parsed.receiptNumber).toBeNull()
    expect(parsed.merchantName).toBeNull()
    expect(parsed.tamperAssessment).toBeNull()
  })

  it('returns confidence 0.95 for valid total > 0', () => {
    const result = { data: { total: 100, currency: 'HKD', items: [] } }

    const parsed = mapFlowForgeResultToReceipt(result)

    expect(parsed.confidence).toBe(0.95)
  })

  it('returns confidence 0 and fallback for empty result', () => {
    const parsed = mapFlowForgeResultToReceipt(null)

    expect(parsed.confidence).toBe(0)
    expect(parsed.total).toBe(0)
    expect(parsed.items).toEqual([])
    expect(parsed.currency).toBe('HKD')
    expect(parsed.receiptNumber).toBeNull()
    expect(parsed.merchantName).toBeNull()
    expect(parsed.tamperAssessment).toBeNull()
  })

  it('returns fallback for malformed data', () => {
    const parsed = mapFlowForgeResultToReceipt({ data: 'not-an-object' })

    expect(parsed.confidence).toBe(0)
    expect(parsed.total).toBe(0)
    expect(parsed.items).toEqual([])
    expect(parsed.currency).toBe('HKD')
  })

  it('handles missing items array gracefully', () => {
    const result = { data: { total: 50, currency: 'HKD' } }

    const parsed = mapFlowForgeResultToReceipt(result)

    expect(parsed.total).toBe(50)
    expect(parsed.items).toEqual([])
    expect(parsed.confidence).toBe(0.95)
  })

  it('defaults currency to HKD when missing', () => {
    const result = { data: { total: 75, items: [] } }

    const parsed = mapFlowForgeResultToReceipt(result)

    expect(parsed.currency).toBe('HKD')
  })

  it('maps receipt_number to receiptNumber', () => {
    const result = {
      data: { total: 100, currency: 'HKD', items: [], receipt_number: 'INV-001' },
    }

    const parsed = mapFlowForgeResultToReceipt(result)

    expect(parsed.receiptNumber).toBe('INV-001')
  })

  it('maps merchant_name to merchantName', () => {
    const result = {
      data: { total: 100, currency: 'HKD', items: [], merchant_name: 'Good Taste' },
    }

    const parsed = mapFlowForgeResultToReceipt(result)

    expect(parsed.merchantName).toBe('Good Taste')
  })

  it('maps tamper_assessment to tamperAssessment', () => {
    const result = {
      data: {
        total: 100,
        currency: 'HKD',
        items: [],
        tamper_assessment: {
          is_suspicious: true,
          reasons: ['Inconsistent fonts'],
        },
      },
    }

    const parsed = mapFlowForgeResultToReceipt(result)

    expect(parsed.tamperAssessment).toEqual({
      isSuspicious: true,
      reasons: ['Inconsistent fonts'],
    })
  })

  it('returns null tamperAssessment for invalid structure', () => {
    const result = {
      data: { total: 100, currency: 'HKD', items: [], tamper_assessment: 'bad' },
    }

    const parsed = mapFlowForgeResultToReceipt(result)

    expect(parsed.tamperAssessment).toBeNull()
  })

  it('maps extracted_data nested structure with new fields', () => {
    const result = {
      data: {
        extracted_data: {
          total: 150,
          currency: 'HKD',
          items: [{ name: 'Tea', price: 30 }],
          receipt_number: 'R-999',
          merchant_name: 'Tea House',
          tamper_assessment: { is_suspicious: false, reasons: [] },
        },
      },
    }

    const parsed = mapFlowForgeResultToReceipt(result)

    expect(parsed.total).toBe(150)
    expect(parsed.receiptNumber).toBe('R-999')
    expect(parsed.merchantName).toBe('Tea House')
    expect(parsed.tamperAssessment).toEqual({ isSuspicious: false, reasons: [] })
  })

  it('returns null receiptNumber for empty string', () => {
    const result = {
      data: { total: 100, currency: 'HKD', items: [], receipt_number: '' },
    }

    const parsed = mapFlowForgeResultToReceipt(result)

    expect(parsed.receiptNumber).toBeNull()
  })
})
