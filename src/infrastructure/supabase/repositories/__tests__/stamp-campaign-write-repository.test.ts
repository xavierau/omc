import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../client', () => ({
  createServerSupabaseClient: vi.fn(),
}))

import { createServerSupabaseClient } from '../../client'
import {
  createStampCampaign,
  setStampCampaignStatus,
  StampCampaignUniqueViolationError,
} from '../stamp-campaign-write-repository'

function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'c-1',
    restaurant_id: 'r-1',
    name: 'Coffee Card',
    name_zh: '咖啡卡',
    stamps_required: 10,
    reward_id: 'rw-1',
    status: 'draft',
    max_stamps_per_day: 1,
    honor_until: null,
    ...overrides,
  }
}

function buildInsertClient(result: { data: unknown; error: unknown }) {
  const single = vi.fn().mockResolvedValue(result)
  const select = vi.fn().mockReturnValue({ single })
  const insert = vi.fn().mockReturnValue({ select })
  const from = vi.fn().mockReturnValue({ insert })
  return { from, insert, select, single }
}

function buildUpdateClient(result: { data: unknown; error: unknown }) {
  const single = vi.fn().mockResolvedValue(result)
  const select = vi.fn().mockReturnValue({ single })
  // .update(...).eq('id',..).eq('restaurant_id',..).select().single()
  const eq2 = vi.fn().mockReturnValue({ select })
  const eq1 = vi.fn().mockReturnValue({ eq: eq2 })
  const update = vi.fn().mockReturnValue({ eq: eq1 })
  const from = vi.fn().mockReturnValue({ update })
  return { from, update, eq1, eq2, select, single }
}

describe('createStampCampaign', () => {
  beforeEach(() => vi.clearAllMocks())

  it('inserts the campaign row and maps it back', async () => {
    const client = buildInsertClient({ data: row(), error: null })
    vi.mocked(createServerSupabaseClient).mockReturnValue({ from: client.from } as never)

    const result = await createStampCampaign({
      restaurantId: 'r-1',
      name: 'Coffee Card',
      nameZh: '咖啡卡',
      stampsRequired: 10,
      rewardId: 'rw-1',
      maxStampsPerDay: 1,
    })

    expect(client.from).toHaveBeenCalledWith('stamp_campaigns')
    const payload = client.insert.mock.calls[0][0] as Record<string, unknown>
    expect(payload).toMatchObject({
      restaurant_id: 'r-1',
      name: 'Coffee Card',
      stamps_required: 10,
      reward_id: 'rw-1',
      status: 'draft',
      max_stamps_per_day: 1,
    })
    expect(result.status).toBe('draft')
  })
})

describe('setStampCampaignStatus', () => {
  beforeEach(() => vi.clearAllMocks())

  it('updates status (tenant-scoped) and maps the row', async () => {
    const client = buildUpdateClient({ data: row({ status: 'active' }), error: null })
    vi.mocked(createServerSupabaseClient).mockReturnValue({ from: client.from } as never)

    const result = await setStampCampaignStatus({
      id: 'c-1',
      restaurantId: 'r-1',
      status: 'active',
    })

    expect(client.eq1).toHaveBeenCalledWith('id', 'c-1')
    expect(client.eq2).toHaveBeenCalledWith('restaurant_id', 'r-1')
    expect(client.update.mock.calls[0][0]).toMatchObject({ status: 'active' })
    expect(result.status).toBe('active')
  })

  it('sets honor_until when ending', async () => {
    const client = buildUpdateClient({ data: row({ status: 'ended' }), error: null })
    vi.mocked(createServerSupabaseClient).mockReturnValue({ from: client.from } as never)

    await setStampCampaignStatus({
      id: 'c-1',
      restaurantId: 'r-1',
      status: 'ended',
      honorUntil: '2026-06-24T00:00:00.000Z',
    })

    expect(client.update.mock.calls[0][0]).toMatchObject({
      status: 'ended',
      honor_until: '2026-06-24T00:00:00.000Z',
    })
  })

  it('throws StampCampaignUniqueViolationError on a 23505 (one-active conflict)', async () => {
    const client = buildUpdateClient({
      data: null,
      error: { code: '23505', message: 'uq_stamp_campaigns_one_active' },
    })
    vi.mocked(createServerSupabaseClient).mockReturnValue({ from: client.from } as never)

    await expect(
      setStampCampaignStatus({ id: 'c-1', restaurantId: 'r-1', status: 'active' })
    ).rejects.toBeInstanceOf(StampCampaignUniqueViolationError)
  })
})
