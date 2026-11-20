import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/infrastructure/supabase/repositories/member-repository')
vi.mock('@/application/emit-event')

import {
  adjustMemberPoints,
  findMemberByIdAndRestaurant,
  findMemberByPhone,
} from '@/infrastructure/supabase/repositories/member-repository'
import { emitEvent } from '@/application/emit-event'
import { addPoints, deductPoints } from '../adjust-points'

const BASE = {
  restaurantId: 'rest-1',
  memberId: 'member-1',
  points: 50,
}

describe('addPoints', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(adjustMemberPoints).mockResolvedValue(150)
    vi.mocked(emitEvent).mockResolvedValue('event-1')
    vi.mocked(findMemberByIdAndRestaurant).mockResolvedValue({
      id: 'member-1',
      pointsBalance: 100,
    })
  })

  it('calls adjustMemberPoints with positive delta', async () => {
    await addPoints(BASE)

    expect(adjustMemberPoints).toHaveBeenCalledWith('member-1', 50)
  })

  it('returns memberId, newBalance, pointsChanged', async () => {
    const result = await addPoints(BASE)

    expect(result).toEqual({
      memberId: 'member-1',
      newBalance: 150,
      pointsChanged: 50,
    })
  })

  it('emits points event with default reason, source, and null reference_id', async () => {
    await addPoints(BASE)

    expect(emitEvent).toHaveBeenCalledWith({
      restaurantId: 'rest-1',
      memberId: 'member-1',
      type: 'points',
      source: undefined,
      dataJson: {
        amount: 50,
        reason: 'external_add',
        source: 'api',
        reference_id: null,
        balance_after: 150,
      },
    })
  })

  it('uses custom reason, source, referenceId in event', async () => {
    await addPoints({
      ...BASE,
      reason: 'pos_sale',
      source: 'stocky',
      referenceId: 'sale-123',
    })

    expect(emitEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'stocky',
        dataJson: expect.objectContaining({
          reason: 'pos_sale',
          source: 'stocky',
          reference_id: 'sale-123',
        }),
      })
    )
  })

  it('rejects zero or negative points', async () => {
    await expect(addPoints({ ...BASE, points: 0 })).rejects.toThrow(
      'Points must be positive'
    )
    await expect(addPoints({ ...BASE, points: -5 })).rejects.toThrow(
      'Points must be positive'
    )
  })

  it('resolves memberId from phone when memberId absent', async () => {
    vi.mocked(findMemberByPhone).mockResolvedValue({
      id: 'found-member',
      name: null, pointsBalance: 80,
      preferredLanguage: null,
    })

    await addPoints({
      restaurantId: 'rest-1',
      phone: '+85291234567',
      points: 10,
    })

    expect(findMemberByPhone).toHaveBeenCalledWith('rest-1', '+85291234567')
    expect(adjustMemberPoints).toHaveBeenCalledWith('found-member', 10)
  })

  it('throws when member not found by phone', async () => {
    vi.mocked(findMemberByPhone).mockResolvedValue(null)

    await expect(
      addPoints({
        restaurantId: 'rest-1',
        phone: '+85200000000',
        points: 50,
      })
    ).rejects.toThrow('Member not found')
  })

  it('throws when neither memberId nor phone provided', async () => {
    await expect(
      addPoints({ restaurantId: 'rest-1', points: 10 })
    ).rejects.toThrow('Either memberId or phone is required')
  })

  it('throws when memberId does not belong to restaurant', async () => {
    vi.mocked(findMemberByIdAndRestaurant).mockResolvedValue(null)

    await expect(
      addPoints({ restaurantId: 'rest-1', memberId: 'wrong-member', points: 10 })
    ).rejects.toThrow('Member not found')
  })

  it('calls findMemberByIdAndRestaurant when memberId is provided', async () => {
    await addPoints(BASE)

    expect(findMemberByIdAndRestaurant).toHaveBeenCalledWith('rest-1', 'member-1')
  })
})

describe('deductPoints', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(adjustMemberPoints).mockResolvedValue(50)
    vi.mocked(emitEvent).mockResolvedValue('event-1')
    vi.mocked(findMemberByIdAndRestaurant).mockResolvedValue({
      id: 'member-1',
      pointsBalance: 100,
    })
  })

  it('calls adjustMemberPoints with negative delta and rejectNegative', async () => {
    await deductPoints(BASE)

    expect(adjustMemberPoints).toHaveBeenCalledWith('member-1', -50, {
      rejectNegative: true,
    })
  })

  it('returns result with negative pointsChanged', async () => {
    const result = await deductPoints(BASE)

    expect(result).toEqual({
      memberId: 'member-1',
      newBalance: 50,
      pointsChanged: -50,
    })
  })

  it('emits event with negative amount', async () => {
    await deductPoints(BASE)

    expect(emitEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        dataJson: expect.objectContaining({
          amount: -50,
          reason: 'external_deduct',
          source: 'api',
        }),
      })
    )
  })

  it('propagates Insufficient points error', async () => {
    vi.mocked(adjustMemberPoints).mockRejectedValue(
      new Error('Insufficient points balance')
    )

    await expect(deductPoints(BASE)).rejects.toThrow(
      'Insufficient points balance'
    )
  })

  it('resolves member by phone', async () => {
    vi.mocked(findMemberByPhone).mockResolvedValue({
      id: 'member-phone',
      name: null, pointsBalance: 100,
      preferredLanguage: null,
    })

    await deductPoints({
      restaurantId: 'rest-1',
      phone: '+85291234567',
      points: 50,
    })

    expect(findMemberByPhone).toHaveBeenCalledWith('rest-1', '+85291234567')
    expect(adjustMemberPoints).toHaveBeenCalledWith('member-phone', -50, {
      rejectNegative: true,
    })
  })

  it('rejects zero or negative points', async () => {
    await expect(deductPoints({ ...BASE, points: 0 })).rejects.toThrow(
      'Points must be positive'
    )
    await expect(deductPoints({ ...BASE, points: -3 })).rejects.toThrow(
      'Points must be positive'
    )
  })
})
