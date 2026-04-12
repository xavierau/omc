import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/infrastructure/supabase/repositories/receipt-repository')
vi.mock('@/infrastructure/supabase/repositories/restaurant-repository')

import { isReceiptNumberUsed } from '@/infrastructure/supabase/repositories/receipt-repository'
import { getRestaurantName } from '@/infrastructure/supabase/repositories/restaurant-repository'
import { validateReceipt } from '../validate-receipt'
import type { ParsedReceipt } from '@/domain/interfaces/parsed-receipt'

function makeParsed(overrides: Partial<ParsedReceipt> = {}): ParsedReceipt {
  return {
    total: 100,
    items: [{ name: 'Item A', price: 100 }],
    confidence: 0.95,
    currency: 'HKD',
    receiptNumber: 'RN-001',
    merchantName: 'Test Restaurant',
    tamperAssessment: null,
    ...overrides,
  }
}

describe('validateReceipt', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(isReceiptNumberUsed).mockResolvedValue(false)
    vi.mocked(getRestaurantName).mockResolvedValue('Test Restaurant')
  })

  it('rejects tampered receipt', async () => {
    const parsed = makeParsed({
      tamperAssessment: { isSuspicious: true, reasons: ['edited'] },
    })

    const result = await validateReceipt({ parsed, restaurantId: 'r-1' })

    expect(result.valid).toBe(false)
    expect(result.rejectionReason).toContain('modified')
  })

  it('rejects duplicate receipt number', async () => {
    vi.mocked(isReceiptNumberUsed).mockResolvedValue(true)
    const parsed = makeParsed()

    const result = await validateReceipt({ parsed, restaurantId: 'r-1' })

    expect(result.valid).toBe(false)
    expect(result.rejectionReason).toContain('already been submitted')
  })

  it('skips duplicate check when receiptNumber is null', async () => {
    const parsed = makeParsed({ receiptNumber: null })

    const result = await validateReceipt({ parsed, restaurantId: 'r-1' })

    expect(isReceiptNumberUsed).not.toHaveBeenCalled()
    expect(result.valid).toBe(true)
  })

  it('rejects merchant mismatch', async () => {
    vi.mocked(getRestaurantName).mockResolvedValue('Fancy Sushi')
    const parsed = makeParsed({ merchantName: 'Totally Different Place' })

    const result = await validateReceipt({ parsed, restaurantId: 'r-1' })

    expect(result.valid).toBe(false)
    expect(result.rejectionReason).toContain("doesn't appear to be from our restaurant")
  })

  it('returns valid for a clean receipt', async () => {
    const parsed = makeParsed()

    const result = await validateReceipt({ parsed, restaurantId: 'r-1' })

    expect(result).toEqual({ valid: true })
  })
})
