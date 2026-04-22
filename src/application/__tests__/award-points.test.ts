import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/infrastructure/supabase/repositories/receipt-repository')
vi.mock('@/application/emit-event')
vi.mock('@/infrastructure/whatsapp/messaging')
vi.mock('@/infrastructure/supabase/repositories/member-repository')

import { updateReceipt } from '@/infrastructure/supabase/repositories/receipt-repository'
import { emitEvent } from '@/application/emit-event'
import { sendTextMessage } from '@/infrastructure/whatsapp/messaging'
import { adjustMemberPoints } from '@/infrastructure/supabase/repositories/member-repository'
import { awardPoints } from '../award-points'
import { Language } from '@/domain/value-objects/language'

const BASE_PARAMS = {
  receiptId: 'r-1',
  memberId: 'm-1',
  restaurantId: 'rest-1',
  phoneNumberId: 'pn-1',
  amount: 100,
  parsed: { confidence: 0.95, receiptNumber: 'RN-001', merchantName: 'Test' },
  phone: '+85291234567',
  language: Language.EN,
}

describe('awardPoints', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(updateReceipt).mockResolvedValue(undefined as never)
    vi.mocked(emitEvent).mockResolvedValue('event-1')
    vi.mocked(sendTextMessage).mockResolvedValue(undefined)
    vi.mocked(adjustMemberPoints).mockResolvedValue(60)
  })

  it('calculates points as floor(amount / POINTS_PER_DOLLAR)', async () => {
    await awardPoints(BASE_PARAMS)

    // 100 / 10 = 10 points, adjustMemberPoints returns 60
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
    vi.mocked(adjustMemberPoints).mockResolvedValueOnce(210)

    await awardPoints(BASE_PARAMS)

    expect(adjustMemberPoints).toHaveBeenCalledWith('m-1', 10)
  })

  it('creates receipt and points events', async () => {
    await awardPoints(BASE_PARAMS)

    expect(emitEvent).toHaveBeenCalledTimes(2)
    expect(emitEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        restaurantId: 'rest-1',
        memberId: 'm-1',
        type: 'receipt',
        dataJson: expect.objectContaining({ receipt_id: 'r-1', amount: 100 }),
      })
    )
    expect(emitEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'points',
        dataJson: expect.objectContaining({ amount: 10, reason: 'receipt' }),
      })
    )
  })

  // ONBOARD-008: localized copy
  it('ZH: sends ZH points-earned message with 積分 and 繼續努力', async () => {
    await awardPoints({ ...BASE_PARAMS, language: Language.ZH_HK })

    const call = vi.mocked(sendTextMessage).mock.calls[0]
    expect(call[2]).toContain('積分')
    expect(call[2]).toContain('10')
    expect(call[2]).toContain('60')
    expect(call[2]).toMatch(/繼續|加油/)
  })
})
