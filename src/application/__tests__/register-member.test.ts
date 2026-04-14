import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/infrastructure/supabase/client')
vi.mock('@/infrastructure/supabase/repositories/coupon-repository')
vi.mock('@/application/emit-event')
vi.mock('@/infrastructure/supabase/repositories/restaurant-repository')
vi.mock('@/infrastructure/supabase/repositories/campaign-repository')
vi.mock('@/infrastructure/whatsapp/messaging')
vi.mock('@/infrastructure/supabase/storage')

import { createServerSupabaseClient } from '@/infrastructure/supabase/client'
import { createWelcomeCoupon } from '@/infrastructure/supabase/repositories/coupon-repository'
import { emitEvent } from '@/application/emit-event'
import { getRestaurantPhoneNumberId } from '@/infrastructure/supabase/repositories/restaurant-repository'
import { incrementCampaignSent } from '@/infrastructure/supabase/repositories/campaign-repository'
import { sendTextMessage, sendImageMessage } from '@/infrastructure/whatsapp/messaging'
import { uploadCouponQr } from '@/infrastructure/supabase/storage'
import { registerMember } from '../register-member'

const mockSingle = vi.fn()
const mockEq3 = vi.fn().mockReturnValue({ single: mockSingle })
const mockEq2 = vi.fn().mockReturnValue({ eq: mockEq3, single: mockSingle })
const mockEq1 = vi.fn().mockReturnValue({ eq: mockEq2 })
const mockSelect = vi.fn().mockReturnValue({ eq: mockEq1 })
const mockInsertSingle = vi.fn()
const mockInsertSelect = vi.fn().mockReturnValue({ single: mockInsertSingle })
const mockInsert = vi.fn().mockReturnValue({ select: mockInsertSelect })
const mockFrom = vi.fn().mockReturnValue({ select: mockSelect, insert: mockInsert })
const mockSupabase = { from: mockFrom }

const RESTAURANT_ID = 'rest-1'
const PHONE_NUMBER_ID = 'pn-1'
const VALID_PHONE = '+85291234567'

describe('registerMember', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(createServerSupabaseClient).mockReturnValue(mockSupabase as never)
    vi.mocked(getRestaurantPhoneNumberId).mockResolvedValue(PHONE_NUMBER_ID)
    vi.mocked(sendTextMessage).mockResolvedValue(undefined)
    vi.mocked(sendImageMessage).mockResolvedValue(undefined)
    vi.mocked(uploadCouponQr).mockResolvedValue('https://qr.example.com/img.png')
    vi.mocked(createWelcomeCoupon).mockResolvedValue({ code: 'WELCOME1', id: 'c-1' } as never)
    vi.mocked(emitEvent).mockResolvedValue(undefined as never)
    vi.mocked(incrementCampaignSent).mockResolvedValue(undefined as never)
  })

  it('returns isNew false for existing member', async () => {
    mockSingle.mockResolvedValueOnce({
      data: { id: 'm-1', points_balance: 50, name: null },
      error: null,
    })

    const result = await registerMember(RESTAURANT_ID, VALID_PHONE)

    expect(result).toEqual({ isNew: false, memberId: 'm-1', pointsBalance: 50 })
    expect(sendTextMessage).toHaveBeenCalledWith(
      PHONE_NUMBER_ID,
      VALID_PHONE,
      expect.stringContaining('Welcome back!')
    )
  })

  it('includes name in greeting for existing member with name', async () => {
    mockSingle.mockResolvedValueOnce({
      data: { id: 'm-2', points_balance: 100, name: 'Alice' },
      error: null,
    })

    await registerMember(RESTAURANT_ID, VALID_PHONE)

    expect(sendTextMessage).toHaveBeenCalledWith(
      PHONE_NUMBER_ID,
      VALID_PHONE,
      expect.stringContaining('Welcome back, Alice!')
    )
  })

  it('creates new member with coupon and events', async () => {
    // First call: member lookup returns null
    mockSingle.mockResolvedValueOnce({ data: null, error: null })
    // Second call: insert returns new member
    mockInsertSingle.mockResolvedValueOnce({ data: { id: 'm-new' }, error: null })
    // Third call: campaign lookup returns null
    mockSingle.mockResolvedValueOnce({ data: null, error: null })

    const result = await registerMember(RESTAURANT_ID, VALID_PHONE, 'Bob')

    expect(result).toEqual({
      isNew: true,
      memberId: 'm-new',
      pointsBalance: 0,
      couponCode: 'WELCOME1',
    })
    expect(createWelcomeCoupon).toHaveBeenCalledWith(RESTAURANT_ID, 'm-new')
    expect(emitEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        restaurantId: RESTAURANT_ID,
        memberId: 'm-new',
        type: 'join',
      })
    )
    expect(sendTextMessage).toHaveBeenCalledWith(
      PHONE_NUMBER_ID,
      VALID_PHONE,
      expect.stringContaining('Bob')
    )
  })

  it('increments campaign sent for active welcome campaign', async () => {
    mockSingle.mockResolvedValueOnce({ data: null, error: null })
    mockInsertSingle.mockResolvedValueOnce({ data: { id: 'm-new' }, error: null })
    mockSingle.mockResolvedValueOnce({
      data: { id: 'camp-1', template: 'Hello {{name}}' },
      error: null,
    })

    await registerMember(RESTAURANT_ID, VALID_PHONE)

    expect(incrementCampaignSent).toHaveBeenCalledWith('camp-1')
  })

  it('catches QR send failure gracefully', async () => {
    mockSingle.mockResolvedValueOnce({ data: null, error: null })
    mockInsertSingle.mockResolvedValueOnce({ data: { id: 'm-new' }, error: null })
    mockSingle.mockResolvedValueOnce({ data: null, error: null })
    vi.mocked(uploadCouponQr).mockRejectedValueOnce(new Error('upload failed'))

    const result = await registerMember(RESTAURANT_ID, VALID_PHONE)

    expect(result.isNew).toBe(true)
    expect(result.memberId).toBe('m-new')
  })

  it('throws for invalid phone number', async () => {
    await expect(registerMember(RESTAURANT_ID, '123')).rejects.toThrow('Invalid phone number')
    expect(mockFrom).not.toHaveBeenCalled()
  })
})
