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
  const resolved = { error }
  const isFn: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue(resolved)
  // eq() returns a thenable AND something with .is() for the guarded path.
  const eq: ReturnType<typeof vi.fn> = vi.fn()
  // Default: a thenable (awaited directly).
  eq.mockImplementation(() => ({
    is: isFn,
    then: (onFulfilled: (v: typeof resolved) => unknown) =>
      Promise.resolve(resolved).then(onFulfilled),
  }))
  const update = vi.fn().mockReturnValue({ eq })
  const from = vi.fn().mockReturnValue({ update })
  return { from, update, eq, is: isFn }
}

describe('setMemberPreferredLanguageIfUnset', () => {
  beforeEach(() => vi.clearAllMocks())

  it('includes .is(preferred_language, null) in the WHERE clause to guard TOCTOU', async () => {
    const stub = buildStub()
    vi.mocked(createServerSupabaseClient).mockReturnValue({
      from: stub.from,
    } as never)

    await setMemberPreferredLanguageIfUnset('m-1', 'en')

    expect(stub.from).toHaveBeenCalledWith('members')
    expect(stub.update).toHaveBeenCalledWith({ preferred_language: 'en' })
    expect(stub.eq).toHaveBeenCalledWith('id', 'm-1')
    expect(stub.is).toHaveBeenCalledWith('preferred_language', null)
  })

  it('throws when supabase returns an error', async () => {
    const stub = buildStub({ message: 'db down' })
    vi.mocked(createServerSupabaseClient).mockReturnValue({
      from: stub.from,
    } as never)

    await expect(
      setMemberPreferredLanguageIfUnset('m-1', 'zh_hk')
    ).rejects.toThrow('db down')
  })
})

describe('updateMemberPreferredLanguage (unconditional, used by explicit LANG command)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('does NOT add a preferred_language=null guard (explicit overwrite)', async () => {
    const stub = buildStub()
    vi.mocked(createServerSupabaseClient).mockReturnValue({
      from: stub.from,
    } as never)

    await updateMemberPreferredLanguage('m-1', 'en')

    expect(stub.update).toHaveBeenCalledWith({ preferred_language: 'en' })
    expect(stub.is).not.toHaveBeenCalled()
  })
})
