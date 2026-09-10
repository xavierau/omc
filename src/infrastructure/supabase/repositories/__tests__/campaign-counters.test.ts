import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../client', () => ({
  createServerSupabaseClient: vi.fn(),
}))

import { createServerSupabaseClient } from '../../client'
import { retractCampaignSent } from '../campaign-counters'

function buildRpcClient(result: {
  data: unknown
  error: { message: string } | null
}): {
  client: ReturnType<typeof createServerSupabaseClient>
  rpc: ReturnType<typeof vi.fn>
} {
  const rpc = vi.fn().mockResolvedValue(result)
  return {
    client: { rpc } as unknown as ReturnType<typeof createServerSupabaseClient>,
    rpc,
  }
}

describe('retractCampaignSent (migration 064)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('maps args to the RPC and the returned row back to camelCase', async () => {
    const { client, rpc } = buildRpcClient({
      data: [
        { status: 'failed', chargeable_sent_count: 0, non_chargeable_sent_count: 0 },
      ],
      error: null,
    })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    const result = await retractCampaignSent({
      campaignId: 'camp-1',
      restaurantId: 'r-1',
      failureReason: 'WhatsApp (Meta) rejected every message. Not an OhMyClient issue.',
    })

    expect(rpc).toHaveBeenCalledWith('retract_campaign_sent', {
      p_campaign_id: 'camp-1',
      p_restaurant_id: 'r-1',
      p_failure_reason: 'WhatsApp (Meta) rejected every message. Not an OhMyClient issue.',
    })
    expect(result).toEqual({
      status: 'failed',
      chargeableSentCount: 0,
      nonChargeableSentCount: 0,
    })
  })

  it('returns null when no row matched (wrong id/tenant)', async () => {
    const { client } = buildRpcClient({ data: [], error: null })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    const result = await retractCampaignSent({
      campaignId: 'camp-missing',
      restaurantId: 'r-1',
      failureReason: 'reason',
    })

    expect(result).toBeNull()
  })

  it('also handles a single-object RPC response (non-array)', async () => {
    const { client } = buildRpcClient({
      data: { status: 'sending', chargeable_sent_count: 1, non_chargeable_sent_count: 0 },
      error: null,
    })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    const result = await retractCampaignSent({
      campaignId: 'camp-1',
      restaurantId: 'r-1',
      failureReason: 'reason',
    })

    expect(result).toEqual({
      status: 'sending',
      chargeableSentCount: 1,
      nonChargeableSentCount: 0,
    })
  })

  it('throws a contextual error when the RPC returns an error', async () => {
    const { client } = buildRpcClient({
      data: null,
      error: { message: 'function retract_campaign_sent does not exist' },
    })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    await expect(
      retractCampaignSent({
        campaignId: 'camp-1',
        restaurantId: 'r-1',
        failureReason: 'reason',
      })
    ).rejects.toThrow(/retractCampaignSent.*does not exist/)
  })
})
