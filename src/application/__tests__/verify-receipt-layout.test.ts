import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/infrastructure/layout-service/client')
vi.mock('@/infrastructure/supabase/repositories/layout-template-repository')
vi.mock('@/infrastructure/supabase/repositories/receipt-repository')

import { verifyReceiptLayout as callVerifyLayout } from '@/infrastructure/layout-service/client'
import { getActiveTemplate } from '@/infrastructure/supabase/repositories/layout-template-repository'
import { updateReceipt } from '@/infrastructure/supabase/repositories/receipt-repository'
import { verifyReceiptLayout } from '../verify-receipt-layout'

const BASE_PARAMS = {
  receiptId: 'r-1',
  restaurantId: 'rest-1',
  imageUrl: 'https://example.com/receipt.jpg',
}

const PASSING_RESULT = {
  score: 0.95,
  passed: true,
  aspect_ratio_score: 0.98,
  region_match_score: 0.92,
  spatial_score: 0.95,
  missing_regions: [] as string[],
  extra_regions: [] as string[],
}

const FAILING_RESULT = {
  ...PASSING_RESULT,
  score: 0.4,
  passed: false,
  missing_regions: ['logo', 'total'],
}

const ACTIVE_TEMPLATE = {
  template_json: { regions: [{ name: 'logo' }] },
  threshold: 0.8,
}

describe('verifyReceiptLayout', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(updateReceipt).mockResolvedValue(undefined as never)
  })

  it('returns early when no active template exists', async () => {
    vi.mocked(getActiveTemplate).mockResolvedValue(null as never)

    await verifyReceiptLayout(BASE_PARAMS)

    expect(callVerifyLayout).not.toHaveBeenCalled()
    expect(updateReceipt).not.toHaveBeenCalled()
  })

  it('updates receipt with scores but does not flag when layout passes', async () => {
    vi.mocked(getActiveTemplate).mockResolvedValue(ACTIVE_TEMPLATE as never)
    vi.mocked(callVerifyLayout).mockResolvedValue(PASSING_RESULT as never)

    await verifyReceiptLayout(BASE_PARAMS)

    expect(callVerifyLayout).toHaveBeenCalledWith(
      BASE_PARAMS.imageUrl,
      ACTIVE_TEMPLATE.template_json,
      ACTIVE_TEMPLATE.threshold
    )
    expect(updateReceipt).toHaveBeenCalledTimes(1)
    expect(updateReceipt).toHaveBeenCalledWith('r-1', {
      layout_score: 0.95,
      layout_flags: expect.objectContaining({
        aspect_ratio_score: 0.98,
        region_match_score: 0.92,
        missing_regions: [],
      }),
    })
  })

  it('flags receipt when layout verification fails', async () => {
    vi.mocked(getActiveTemplate).mockResolvedValue(ACTIVE_TEMPLATE as never)
    vi.mocked(callVerifyLayout).mockResolvedValue(FAILING_RESULT as never)

    await verifyReceiptLayout(BASE_PARAMS)

    expect(updateReceipt).toHaveBeenCalledTimes(2)
    expect(updateReceipt).toHaveBeenCalledWith('r-1', {
      layout_score: 0.4,
      layout_flags: expect.objectContaining({
        missing_regions: ['logo', 'total'],
      }),
    })
    expect(updateReceipt).toHaveBeenCalledWith('r-1', { status: 'flagged' })
  })
})
