import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../client', () => ({
  createServerSupabaseClient: vi.fn(),
}))

import { createServerSupabaseClient } from '../../client'
import {
  countFailedCampaignQrImages,
  findLatestCampaignFailure,
} from '../whatsapp-message-campaign-queries'

function chainClient(result: Record<string, unknown>) {
  const select = vi.fn()
  const eq = vi.fn()
  const chain: Record<string, unknown> = {
    select,
    eq,
    in: () => chain,
    order: () => chain,
    limit: () => chain,
    maybeSingle: () => Promise.resolve(result),
    then: (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve),
  }
  select.mockReturnValue(chain)
  eq.mockReturnValue(chain)
  vi.mocked(createServerSupabaseClient).mockReturnValue({ from: () => chain } as never)
  return { select, eq }
}

describe('countFailedCampaignQrImages (CAMP-014)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('counts failed image rows for the tenant with an exact head count, reading no rows', async () => {
    const { select, eq } = chainClient({ count: 7, error: null, data: null })

    const count = await countFailedCampaignQrImages({ campaignId: 'c-1', restaurantId: 'r-1' })

    expect(count).toBe(7)
    expect(select).toHaveBeenCalledWith('id', { count: 'exact', head: true })
    expect(eq.mock.calls).toEqual(
      expect.arrayContaining([
        ['campaign_id', 'c-1'],
        ['restaurant_id', 'r-1'],
        ['message_type', 'image'],
        ['status', 'failed'],
      ])
    )
  })

  it('reads a null count as zero', async () => {
    chainClient({ count: null, error: null })
    await expect(
      countFailedCampaignQrImages({ campaignId: 'c-1', restaurantId: 'r-1' })
    ).resolves.toBe(0)
  })

  it('throws on a query error, so the list can degrade instead of reporting zero', async () => {
    chainClient({ count: null, error: { message: 'db down' } })
    await expect(
      countFailedCampaignQrImages({ campaignId: 'c-1', restaurantId: 'r-1' })
    ).rejects.toThrow('countFailedCampaignQrImages: db down')
  })
})

describe('findLatestCampaignFailure', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns the error details the reason is worded from (CAMP-014)', async () => {
    const { select } = chainClient({
      data: { error_code: '131042', error_title: 'T', error_details: 'payment has been restricted' },
      error: null,
    })

    await expect(findLatestCampaignFailure('c-1', 'r-1')).resolves.toEqual({
      errorCode: '131042',
      errorTitle: 'T',
      errorDetails: 'payment has been restricted',
    })
    expect(select).toHaveBeenCalledWith('error_code, error_title, error_details')
  })
})
