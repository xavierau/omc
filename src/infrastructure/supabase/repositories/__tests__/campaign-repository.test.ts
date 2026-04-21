import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../client', () => ({
  createServerSupabaseClient: vi.fn(),
}))

import { createServerSupabaseClient } from '../../client'
import {
  mapRowToCampaign,
  incrementCampaignSent,
  setCampaignChargeable,
} from '../campaign-repository'

function buildRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'camp-1',
    restaurant_id: 'rest-1',
    name: 'Welcome',
    type: 'welcome',
    template: 'Hi {{name}}',
    coupon_config: null,
    schedule: null,
    scheduled_at: null,
    status: 'active',
    is_chargeable: false,
    chargeable_sent_count: 0,
    non_chargeable_sent_count: 7,
    redeemed_count: 3,
    whatsapp_template_id: null,
    target_audience: 'all',
    created_at: '2026-04-20T00:00:00Z',
    ...overrides,
  }
}

describe('mapRowToCampaign', () => {
  it('maps snake_case DB row to camelCase Campaign with split counters', () => {
    const campaign = mapRowToCampaign(buildRow())
    expect(campaign).toMatchObject({
      id: 'camp-1',
      isChargeable: false,
      chargeableSentCount: 0,
      nonChargeableSentCount: 7,
      redeemedCount: 3,
    })
  })

  it('defaults is_chargeable to true when column is missing (legacy rows)', () => {
    const campaign = mapRowToCampaign(buildRow({ is_chargeable: undefined }))
    expect(campaign.isChargeable).toBe(true)
  })

  it('defaults counter columns to 0 when missing', () => {
    const campaign = mapRowToCampaign(
      buildRow({ chargeable_sent_count: undefined, non_chargeable_sent_count: undefined })
    )
    expect(campaign.chargeableSentCount).toBe(0)
    expect(campaign.nonChargeableSentCount).toBe(0)
  })
})

function buildRpcClient(error: { message: string } | null = null) {
  const rpc = vi.fn().mockResolvedValue({ error })
  return { rpc }
}

describe('incrementCampaignSent (atomic RPC)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('calls the increment_chargeable_sent RPC when isChargeable=true', async () => {
    const client = buildRpcClient()
    vi.mocked(createServerSupabaseClient).mockReturnValue({ rpc: client.rpc } as never)

    await incrementCampaignSent('camp-1', true)

    expect(client.rpc).toHaveBeenCalledWith('increment_chargeable_sent', {
      p_campaign_id: 'camp-1',
    })
  })

  it('calls the increment_non_chargeable_sent RPC when isChargeable=false', async () => {
    const client = buildRpcClient()
    vi.mocked(createServerSupabaseClient).mockReturnValue({ rpc: client.rpc } as never)

    await incrementCampaignSent('camp-1', false)

    expect(client.rpc).toHaveBeenCalledWith('increment_non_chargeable_sent', {
      p_campaign_id: 'camp-1',
    })
  })

  it('throws when the RPC call fails', async () => {
    const client = buildRpcClient({ message: 'rpc denied' })
    vi.mocked(createServerSupabaseClient).mockReturnValue({ rpc: client.rpc } as never)

    await expect(incrementCampaignSent('camp-1', true)).rejects.toThrow(
      'incrementCampaignSent: rpc denied'
    )
  })
})

describe('setCampaignChargeable', () => {
  beforeEach(() => vi.clearAllMocks())

  it('sets is_chargeable=true on the campaign row', async () => {
    const updateEq = vi.fn().mockResolvedValue({ error: null })
    const update = vi.fn().mockReturnValue({ eq: updateEq })
    const from = vi.fn().mockReturnValue({ update })
    vi.mocked(createServerSupabaseClient).mockReturnValue({ from } as never)

    await setCampaignChargeable('camp-1', true)

    expect(update).toHaveBeenCalledWith({ is_chargeable: true })
    expect(updateEq).toHaveBeenCalledWith('id', 'camp-1')
  })

  it('sets is_chargeable=false on the campaign row', async () => {
    const updateEq = vi.fn().mockResolvedValue({ error: null })
    const update = vi.fn().mockReturnValue({ eq: updateEq })
    const from = vi.fn().mockReturnValue({ update })
    vi.mocked(createServerSupabaseClient).mockReturnValue({ from } as never)

    await setCampaignChargeable('camp-1', false)

    expect(update).toHaveBeenCalledWith({ is_chargeable: false })
  })

  it('throws when the update fails', async () => {
    const updateEq = vi.fn().mockResolvedValue({ error: { message: 'denied' } })
    const update = vi.fn().mockReturnValue({ eq: updateEq })
    const from = vi.fn().mockReturnValue({ update })
    vi.mocked(createServerSupabaseClient).mockReturnValue({ from } as never)

    await expect(setCampaignChargeable('camp-1', true)).rejects.toThrow('setCampaignChargeable')
  })
})
