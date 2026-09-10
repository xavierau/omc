import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../client', () => ({
  createServerSupabaseClient: vi.fn(),
}))

import { createServerSupabaseClient } from '../../client'
import { deleteMemberAndCascade } from '../member-delete-cascade'

const MEMBER_ID = 'member-uuid'
const RESTAURANT_ID = 'restaurant-uuid'

function buildStub(rpcError: { message: string } | null = null) {
  const rpc = vi.fn().mockResolvedValue({ data: null, error: rpcError })
  return { rpc }
}

describe('deleteMemberAndCascade', () => {
  beforeEach(() => vi.clearAllMocks())

  it('calls the delete_member_cascade RPC with tenant-scoped args', async () => {
    const stub = buildStub()
    vi.mocked(createServerSupabaseClient).mockReturnValue(stub as never)

    await deleteMemberAndCascade(MEMBER_ID, RESTAURANT_ID)

    expect(stub.rpc).toHaveBeenCalledTimes(1)
    expect(stub.rpc).toHaveBeenCalledWith('delete_member_cascade', {
      p_member_id: MEMBER_ID,
      p_restaurant_id: RESTAURANT_ID,
    })
  })

  it('throws when the RPC returns an error', async () => {
    const stub = buildStub({ message: 'boom' })
    vi.mocked(createServerSupabaseClient).mockReturnValue(stub as never)

    await expect(
      deleteMemberAndCascade(MEMBER_ID, RESTAURANT_ID)
    ).rejects.toThrow(/boom/)
  })

  it('resolves to void on success', async () => {
    const stub = buildStub()
    vi.mocked(createServerSupabaseClient).mockReturnValue(stub as never)

    await expect(
      deleteMemberAndCascade(MEMBER_ID, RESTAURANT_ID)
    ).resolves.toBeUndefined()
  })
})
