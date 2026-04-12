import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/infrastructure/supabase/repositories/receipt-repository')
vi.mock('@/infrastructure/supabase/repositories/event-repository')
vi.mock('@/infrastructure/kapso/client')
vi.mock('@/infrastructure/supabase/client')

import { updateReceipt } from '@/infrastructure/supabase/repositories/receipt-repository'
import { createEvent } from '@/infrastructure/supabase/repositories/event-repository'
import { sendTextMessage } from '@/infrastructure/kapso/client'
import { createServerSupabaseClient } from '@/infrastructure/supabase/client'
import { awardPoints } from '../award-points'

const mockSingle = vi.fn()
const mockEq = vi.fn().mockReturnValue({ single: mockSingle })
const mockSelect = vi.fn().mockReturnValue({ eq: mockEq })
const mockUpdateEq = vi.fn().mockResolvedValue({ error: null })
const mockUpdate = vi.fn().mockReturnValue({ eq: mockUpdateEq })
const mockFrom = vi.fn().mockReturnValue({ select: mockSelect, update: mockUpdate })
const mockSupabase = { from: mockFrom }

const BASE_PARAMS = {
  receiptId: 'r-1',
  memberId: 'm-1',
  restaurantId: 'rest-1',
  phoneNumberId: 'pn-1',
  amount: 100,
  parsed: { confidence: 0.95, receiptNumber: 'RN-001', merchantName: 'Test' },
  phone: '+85291234567',
}

describe('awardPoints', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(createServerSupabaseClient).mockReturnValue(mockSupabase as never)
    vi.mocked(updateReceipt).mockResolvedValue(undefined as never)
    vi.mocked(createEvent).mockResolvedValue(undefined as never)
    vi.mocked(sendTextMessage).mockResolvedValue(undefined)
    mockSingle.mockResolvedValue({ data: { points_balance: 50 }, error: null })
  })

  it('calculates points as floor(amount / POINTS_PER_DOLLAR)', async () => {
    await awardPoints(BASE_PARAMS)

    // 100 / 10 = 10 points, existing 50 + 10 = 60
    expect(sendTextMessage).toHaveBeenCalledWith(
      'pn-1',
      '+85291234567',
      expect.stringContaining('10 points')
    )
    expect(sendTextMessage).toHaveBeenCalledWith(
      'pn-1',
      '+85291234567',
      expect.stringContaining('60 points')
    )
  })

  it('updates receipt to confirmed status', async () => {
    await awardPoints(BASE_PARAMS)

    expect(updateReceipt).toHaveBeenCalledWith(
      'r-1',
      expect.objectContaining({
        status: 'confirmed',
        total_amount: 100,
        points_awarded: 10,
      })
    )
  })

  it('adds points to member balance', async () => {
    mockSingle.mockResolvedValueOnce({ data: { points_balance: 200 }, error: null })

    await awardPoints(BASE_PARAMS)

    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ points_balance: 210 })
    )
    expect(mockUpdateEq).toHaveBeenCalledWith('id', 'm-1')
  })

  it('creates receipt and points events', async () => {
    await awardPoints(BASE_PARAMS)

    expect(createEvent).toHaveBeenCalledTimes(2)
    expect(createEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        restaurantId: 'rest-1',
        memberId: 'm-1',
        type: 'receipt',
        dataJson: expect.objectContaining({ receipt_id: 'r-1', amount: 100 }),
      })
    )
    expect(createEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'points',
        dataJson: expect.objectContaining({ amount: 10, reason: 'receipt' }),
      })
    )
  })
})
