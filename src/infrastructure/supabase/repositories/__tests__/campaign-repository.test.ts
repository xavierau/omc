import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../client', () => ({
  createServerSupabaseClient: vi.fn(),
}))

import { createServerSupabaseClient } from '../../client'
import {
  mapRowToCampaign,
  incrementCampaignSent,
  createCampaign,
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

// FIX 9: assert that `createCampaign` writes `image_url_en` / `image_url_zh_hk`
// onto the INSERT row. Regression guard: the POST route relies on these
// being persisted; a mapper drift would silently lose the attachment.
function buildInsertSpyClient(returnRow: Record<string, unknown>) {
  const single = vi.fn().mockResolvedValue({ data: returnRow, error: null })
  const select = vi.fn().mockReturnValue({ single })
  const insert = vi.fn().mockReturnValue({ select })
  const from = vi.fn().mockReturnValue({ insert })
  return { from, insert, select, single }
}

describe('createCampaign — INSERT row payload (FIX 9)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('includes image_url_en and image_url_zh_hk when both are provided', async () => {
    const row = {
      id: 'c-1',
      restaurant_id: 'r-1',
      name: 'W',
      type: 'welcome',
      template: '',
      image_url_en: 'https://cdn/en.png',
      image_url_zh_hk: 'https://cdn/zh.png',
      status: 'active',
      target_audience: 'all',
      created_at: '2026-04-20T00:00:00Z',
    }
    const spy = buildInsertSpyClient(row)
    vi.mocked(createServerSupabaseClient).mockReturnValue({ from: spy.from } as never)

    await createCampaign({
      restaurantId: 'r-1',
      name: 'W',
      type: 'welcome',
      legacyTemplate: '',
      imageUrlEn: 'https://cdn/en.png',
      imageUrlZhHk: 'https://cdn/zh.png',
    })

    expect(spy.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        image_url_en: 'https://cdn/en.png',
        image_url_zh_hk: 'https://cdn/zh.png',
      })
    )
  })

  it('writes null image columns when caller omits the fields', async () => {
    const row = {
      id: 'c-1',
      restaurant_id: 'r-1',
      name: 'P',
      type: 'promo',
      template: '',
      status: 'draft',
      target_audience: 'all',
      created_at: '2026-04-20T00:00:00Z',
    }
    const spy = buildInsertSpyClient(row)
    vi.mocked(createServerSupabaseClient).mockReturnValue({ from: spy.from } as never)

    await createCampaign({
      restaurantId: 'r-1',
      name: 'P',
      type: 'promo',
      legacyTemplate: '',
    })

    expect(spy.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        image_url_en: null,
        image_url_zh_hk: null,
      })
    )
  })
})

