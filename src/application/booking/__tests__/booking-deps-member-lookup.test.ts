// BOOK-008 r1 F7 (/code-review PR #214): the poppy-promotion link looked the
// member up with findMemberByPhone, which answers null on a DB error, so a
// failed lookup read as "no member" and linkExistingMember never logged it.
// The confirm-code path now uses a lookup that throws; every other booking
// path keeps findMemberByPhone's behaviour.
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/infrastructure/supabase/repositories/member-repository', () => ({
  findMemberByPhone: vi.fn(async () => null),
  findMemberIdByPhoneStrict: vi.fn(),
}))

import { findMemberByPhone, findMemberIdByPhoneStrict } from '@/infrastructure/supabase/repositories/member-repository'
import { members, verifyAgentBookingDeps } from '../booking-deps'

beforeEach(() => vi.clearAllMocks())

describe('member lookups in the booking composition root (r1 F7)', () => {
  it('the confirm-code (poppy promotion) lookup throws on a DB error', async () => {
    vi.mocked(findMemberIdByPhoneStrict).mockRejectedValue(new Error('findMemberIdByPhoneStrict: 57014'))
    await expect(verifyAgentBookingDeps().members.findMemberId('r-a', '+85290000001')).rejects.toThrow('57014')
    expect(findMemberByPhone).not.toHaveBeenCalled()
  })

  it('the confirm-code lookup answers the member id, or null for no member', async () => {
    vi.mocked(findMemberIdByPhoneStrict).mockResolvedValueOnce('m-1').mockResolvedValueOnce(null)
    const lookup = verifyAgentBookingDeps().members
    expect(await lookup.findMemberId('r-a', '+85290000001')).toBe('m-1')
    expect(await lookup.findMemberId('r-a', '+85290000002')).toBeNull()
    expect(findMemberIdByPhoneStrict).toHaveBeenCalledWith('r-a', '+85290000001')
  })

  it('the page / agent submission lookup is unchanged: findMemberByPhone', async () => {
    expect(await members.findMemberId('r-a', '+85290000001')).toBeNull()
    expect(findMemberByPhone).toHaveBeenCalledWith('r-a', '+85290000001')
    expect(findMemberIdByPhoneStrict).not.toHaveBeenCalled()
  })
})
