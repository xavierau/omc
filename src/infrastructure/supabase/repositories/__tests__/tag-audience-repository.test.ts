import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../client', () => ({
  createServerSupabaseClient: vi.fn(),
}))

import { createServerSupabaseClient } from '../../client'
import { countActiveMembersByTags } from '../tag-audience-repository'

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

describe('countActiveMembersByTags (migration 067)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('calls the RPC with the tag ids and restaurant id, returns the count', async () => {
    const { client, rpc } = buildRpcClient({ data: 3, error: null })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    const count = await countActiveMembersByTags(['t-1', 't-2'], 'r-1')

    expect(rpc).toHaveBeenCalledWith('count_active_members_by_tags', {
      p_restaurant_id: 'r-1',
      p_tag_ids: ['t-1', 't-2'],
    })
    expect(count).toBe(3)
  })

  it('returns 0 for an empty tagIds array without calling the RPC', async () => {
    const { client, rpc } = buildRpcClient({ data: null, error: null })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    const count = await countActiveMembersByTags([], 'r-1')

    expect(count).toBe(0)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('returns 0 when a tag has zero matching members (RPC returns 0)', async () => {
    const { client } = buildRpcClient({ data: 0, error: null })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    const count = await countActiveMembersByTags(['t-1'], 'r-1')

    expect(count).toBe(0)
  })

  it('throws when the RPC reports an error', async () => {
    const { client } = buildRpcClient({ data: null, error: { message: 'db down' } })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    await expect(countActiveMembersByTags(['t-1'], 'r-1')).rejects.toThrow('db down')
  })
})
