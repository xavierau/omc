import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../client', () => ({
  createServerSupabaseClient: vi.fn(),
}))

import { createServerSupabaseClient } from '../../client'
import { findMemberForOutboundPayload } from '../integration-outbound-member-repository'

function buildClient(data: Record<string, unknown> | null, error: { message: string } | null = null) {
  const maybeSingle = vi.fn().mockResolvedValue({ data, error })
  const eq = vi.fn().mockReturnValue({ maybeSingle })
  const select = vi.fn().mockReturnValue({ eq })
  const from = vi.fn().mockReturnValue({ select })
  return { client: { from } as unknown as ReturnType<typeof createServerSupabaseClient>, select, eq }
}

describe('findMemberForOutboundPayload', () => {
  beforeEach(() => vi.clearAllMocks())

  it('maps the row to camelCase, attempt-time (T-H7: read from Postgres, not a cached snapshot)', async () => {
    const { client, eq } = buildClient({
      id: 'm-1',
      restaurant_id: 'r-1',
      phone: '+85298765432',
      name: 'Ada',
      status: 'active',
      preferred_language: 'zh_hk',
      joined_at: '2026-09-10T00:00:00.000Z',
    })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    const result = await findMemberForOutboundPayload('m-1')

    expect(result).toEqual({
      id: 'm-1',
      restaurantId: 'r-1',
      phone: '+85298765432',
      name: 'Ada',
      status: 'active',
      preferredLanguage: 'zh_hk',
      joinedAt: '2026-09-10T00:00:00.000Z',
    })
    expect(eq).toHaveBeenCalledWith('id', 'm-1')
  })

  it('returns null when the member no longer exists', async () => {
    const { client } = buildClient(null)
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    const result = await findMemberForOutboundPayload('m-deleted')
    expect(result).toBeNull()
  })

  it('throws a contextual error on a database failure', async () => {
    const { client } = buildClient(null, { message: 'connection lost' })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    await expect(findMemberForOutboundPayload('m-1')).rejects.toThrow(
      /findMemberForOutboundPayload.*connection lost/
    )
  })
})
