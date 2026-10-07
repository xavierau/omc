import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../client', () => ({
  createServerSupabaseClient: vi.fn(),
}))

import { createServerSupabaseClient } from '../../client'
import { getOrCreateTagsByName } from '../tag-get-or-create'

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

describe('getOrCreateTagsByName (migration 068)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('calls upsert_tags_by_name with the tenant id and names', async () => {
    const { client, rpc } = buildRpcClient({
      data: [
        { id: 't-vip', name: 'VIP' },
        { id: 't-lunch', name: 'Lunch' },
      ],
      error: null,
    })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    const map = await getOrCreateTagsByName('r-1', ['VIP', 'Lunch'])

    expect(rpc).toHaveBeenCalledWith('upsert_tags_by_name', {
      p_restaurant_id: 'r-1',
      p_names: ['VIP', 'Lunch'],
    })
    expect(map.get('vip')).toBe('t-vip')
    expect(map.get('lunch')).toBe('t-lunch')
  })

  // T-B2.2 / replacement for T-B2.9: the RPC answers with the tenant's stored
  // casing; the map is keyed by tagKey so a differently-cased CSV name resolves.
  it('keys the map by tagKey so stored casing does not have to match the request', async () => {
    const { client } = buildRpcClient({
      data: [{ id: 't-vip', name: 'VIP' }],
      error: null,
    })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    const map = await getOrCreateTagsByName('r-1', ['vip'])

    expect(map.get('vip')).toBe('t-vip')
    expect(map.size).toBe(1)
  })

  it('trims stored names when building the key', async () => {
    const { client } = buildRpcClient({
      data: [{ id: 't-1', name: '  Lunch  ' }],
      error: null,
    })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    const map = await getOrCreateTagsByName('r-1', ['Lunch'])

    expect(map.get('lunch')).toBe('t-1')
  })

  it('returns an empty map without an RPC call for an empty name list', async () => {
    const { client, rpc } = buildRpcClient({ data: null, error: null })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    const map = await getOrCreateTagsByName('r-1', [])

    expect(map.size).toBe(0)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('returns an empty map when the RPC answers with no rows', async () => {
    const { client } = buildRpcClient({ data: null, error: null })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    const map = await getOrCreateTagsByName('r-1', ['VIP'])

    expect(map.size).toBe(0)
  })

  it('throws when the RPC reports an error (never silently drops a tag)', async () => {
    const { client } = buildRpcClient({
      data: null,
      error: { message: 'tags_name_check violated' },
    })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    await expect(getOrCreateTagsByName('r-1', ['VIP'])).rejects.toThrow(
      'tags_name_check violated'
    )
  })
})
