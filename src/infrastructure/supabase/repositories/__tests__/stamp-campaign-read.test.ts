import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../client', () => ({
  createServerSupabaseClient: vi.fn(),
}))

import { createServerSupabaseClient } from '../../client'
import {
  countRewards,
  rewardExistsForRestaurant,
  findStampableCampaignForMember,
} from '../stamp-campaign-repository'

function mockClient(impl: Record<string, unknown>) {
  vi.mocked(createServerSupabaseClient).mockReturnValue(impl as never)
}

describe('countRewards', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns the tenant reward count (head + exact)', async () => {
    const eq = vi.fn().mockResolvedValue({ count: 3, error: null })
    const select = vi.fn().mockReturnValue({ eq })
    const from = vi.fn().mockReturnValue({ select })
    mockClient({ from })

    const n = await countRewards('r-1')

    expect(from).toHaveBeenCalledWith('rewards')
    expect(select).toHaveBeenCalledWith('id', { count: 'exact', head: true })
    expect(eq).toHaveBeenCalledWith('restaurant_id', 'r-1')
    expect(n).toBe(3)
  })
})

describe('rewardExistsForRestaurant', () => {
  beforeEach(() => vi.clearAllMocks())

  it('true when a matching reward row exists for the tenant', async () => {
    const single = vi.fn().mockResolvedValue({ data: { id: 'rw-1' }, error: null })
    const eq2 = vi.fn().mockReturnValue({ single })
    const eq1 = vi.fn().mockReturnValue({ eq: eq2 })
    const select = vi.fn().mockReturnValue({ eq: eq1 })
    const from = vi.fn().mockReturnValue({ select })
    mockClient({ from })

    const exists = await rewardExistsForRestaurant('rw-1', 'r-1')

    expect(eq1).toHaveBeenCalledWith('id', 'rw-1')
    expect(eq2).toHaveBeenCalledWith('restaurant_id', 'r-1')
    expect(exists).toBe(true)
  })

  it('false when no matching reward (cross-tenant or missing)', async () => {
    const single = vi.fn().mockResolvedValue({ data: null, error: { message: 'no rows' } })
    const eq2 = vi.fn().mockReturnValue({ single })
    const eq1 = vi.fn().mockReturnValue({ eq: eq2 })
    const select = vi.fn().mockReturnValue({ eq: eq1 })
    const from = vi.fn().mockReturnValue({ select })
    mockClient({ from })

    expect(await rewardExistsForRestaurant('rw-x', 'r-1')).toBe(false)
  })
})

describe('findStampableCampaignForMember (honor-window grace path)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns the active campaign when one is running (no member lookup needed)', async () => {
    const single = vi.fn().mockResolvedValue({
      data: { id: 'c-active', stamps_required: 10, reward_id: 'rw', max_stamps_per_day: 1 },
      error: null,
    })
    const eqStatus = vi.fn().mockReturnValue({ single })
    const eqRest = vi.fn().mockReturnValue({ eq: eqStatus })
    const select = vi.fn().mockReturnValue({ eq: eqRest })
    const from = vi.fn().mockReturnValue({ select })
    mockClient({ from })

    const result = await findStampableCampaignForMember('r-1', 'm-1')

    expect(result?.id).toBe('c-active')
    // only the active-campaign query ran
    expect(from).toHaveBeenCalledTimes(1)
  })

  it('falls back to the ended-but-within-honor campaign the member has an in-progress card on', async () => {
    // 1st from() = active campaign lookup → none
    const activeSingle = vi.fn().mockResolvedValue({ data: null, error: { message: 'no rows' } })
    const activeEqStatus = vi.fn().mockReturnValue({ single: activeSingle })
    const activeEqRest = vi.fn().mockReturnValue({ eq: activeEqStatus })
    const activeSelect = vi.fn().mockReturnValue({ eq: activeEqRest })

    // 2nd from() = honor-window join query → one row
    const honorRows = vi.fn().mockResolvedValue({
      data: [
        {
          campaign_id: 'c-ended',
          stamp_campaigns: {
            id: 'c-ended',
            stamps_required: 10,
            reward_id: 'rw',
            max_stamps_per_day: 1,
            status: 'ended',
            honor_until: '2999-01-01T00:00:00Z',
          },
        },
      ],
      error: null,
    })
    const honorGt = vi.fn().mockReturnValue(honorRows())
    const honorEqStatus = vi.fn().mockReturnValue({ gt: honorGt })
    const honorEqMember = vi.fn().mockReturnValue({ eq: honorEqStatus })
    const honorEqRest = vi.fn().mockReturnValue({ eq: honorEqMember })
    const honorSelect = vi.fn().mockReturnValue({ eq: honorEqRest })

    const from = vi
      .fn()
      .mockReturnValueOnce({ select: activeSelect })
      .mockReturnValueOnce({ select: honorSelect })
    mockClient({ from })

    const result = await findStampableCampaignForMember('r-1', 'm-1')

    expect(result?.id).toBe('c-ended')
    expect(from).toHaveBeenCalledTimes(2)
  })

  it('returns null when no active campaign and no in-honor card', async () => {
    const activeSingle = vi.fn().mockResolvedValue({ data: null, error: { message: 'no rows' } })
    const activeEqStatus = vi.fn().mockReturnValue({ single: activeSingle })
    const activeEqRest = vi.fn().mockReturnValue({ eq: activeEqStatus })
    const activeSelect = vi.fn().mockReturnValue({ eq: activeEqRest })

    const honorGt = vi.fn().mockResolvedValue({ data: [], error: null })
    const honorEqStatus = vi.fn().mockReturnValue({ gt: honorGt })
    const honorEqMember = vi.fn().mockReturnValue({ eq: honorEqStatus })
    const honorEqRest = vi.fn().mockReturnValue({ eq: honorEqMember })
    const honorSelect = vi.fn().mockReturnValue({ eq: honorEqRest })

    const from = vi
      .fn()
      .mockReturnValueOnce({ select: activeSelect })
      .mockReturnValueOnce({ select: honorSelect })
    mockClient({ from })

    expect(await findStampableCampaignForMember('r-1', 'm-1')).toBeNull()
  })
})
