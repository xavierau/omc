import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../client', () => ({
  createServerSupabaseClient: vi.fn(),
}))

import { createServerSupabaseClient } from '../../client'
import {
  setMemberPreferredLanguageIfUnset,
  updateMemberPreferredLanguage,
} from '../member-repository'

interface Stub {
  from: ReturnType<typeof vi.fn>
  update: ReturnType<typeof vi.fn>
  eq: ReturnType<typeof vi.fn>
  is: ReturnType<typeof vi.fn>
}

function buildStub(error: { message: string } | null = null): Stub {
  const resolved = { error, count: error ? 0 : 1 }
  const isFn: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue(resolved)
  // eq() is chained multiple times (id + restaurant_id) and must itself be
  // thenable AND expose another .eq() for the next chain step AND expose
  // .is() for the guarded path.
  const eq: ReturnType<typeof vi.fn> = vi.fn()
  eq.mockImplementation(() => ({
    eq,
    is: isFn,
    then: (onFulfilled: (v: typeof resolved) => unknown) =>
      Promise.resolve(resolved).then(onFulfilled),
  }))
  const update = vi.fn().mockReturnValue({ eq })
  const from = vi.fn().mockReturnValue({ update })
  return { from, update, eq, is: isFn }
}

const RESTAURANT_ID = 'rest-uuid'

describe('setMemberPreferredLanguageIfUnset', () => {
  beforeEach(() => vi.clearAllMocks())

  it('includes .eq(id, ...), .eq(restaurant_id, ...), .is(preferred_language, null) in the WHERE clause', async () => {
    const stub = buildStub()
    vi.mocked(createServerSupabaseClient).mockReturnValue({
      from: stub.from,
    } as never)

    await setMemberPreferredLanguageIfUnset('m-1', RESTAURANT_ID, 'en')

    expect(stub.from).toHaveBeenCalledWith('members')
    expect(stub.update).toHaveBeenCalledWith({ preferred_language: 'en' })
    expect(stub.eq).toHaveBeenCalledWith('id', 'm-1')
    expect(stub.eq).toHaveBeenCalledWith('restaurant_id', RESTAURANT_ID)
    expect(stub.is).toHaveBeenCalledWith('preferred_language', null)
  })

  it('throws when supabase returns an error', async () => {
    const stub = buildStub({ message: 'db down' })
    vi.mocked(createServerSupabaseClient).mockReturnValue({
      from: stub.from,
    } as never)

    await expect(
      setMemberPreferredLanguageIfUnset('m-1', RESTAURANT_ID, 'zh_hk')
    ).rejects.toThrow('db down')
  })
})

describe('updateMemberPreferredLanguage (unconditional, used by explicit LANG command)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('includes .eq(id, ...) and .eq(restaurant_id, ...) tenant guard without null guard', async () => {
    const stub = buildStub()
    vi.mocked(createServerSupabaseClient).mockReturnValue({
      from: stub.from,
    } as never)

    await updateMemberPreferredLanguage('m-1', RESTAURANT_ID, 'en')

    expect(stub.update).toHaveBeenCalledWith({ preferred_language: 'en' })
    expect(stub.eq).toHaveBeenCalledWith('id', 'm-1')
    expect(stub.eq).toHaveBeenCalledWith('restaurant_id', RESTAURANT_ID)
    expect(stub.is).not.toHaveBeenCalled()
  })

  it('mismatched restaurantId results in 0 rows updated (no-op, no throw)', async () => {
    // Supabase's .eq('restaurant_id', ...) on a mismatched value returns
    // `{ error: null, count: 0 }` — the UPDATE affects zero rows. We verify
    // the query does not throw; the tenant mismatch is silently a no-op,
    // which is the correct defense-in-depth behavior.
    const stub = buildStub()
    vi.mocked(createServerSupabaseClient).mockReturnValue({
      from: stub.from,
    } as never)

    await expect(
      updateMemberPreferredLanguage('m-1', 'wrong-restaurant', 'en')
    ).resolves.toBeUndefined()

    expect(stub.eq).toHaveBeenCalledWith('restaurant_id', 'wrong-restaurant')
  })
})
