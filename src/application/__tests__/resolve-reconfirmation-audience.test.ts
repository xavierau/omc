import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/infrastructure/supabase/repositories/consent-record-repository', () => ({
  findReconfirmationAudience: vi.fn(),
}))

import { resolveReconfirmationAudience } from '../resolve-reconfirmation-audience'
import { findReconfirmationAudience } from '@/infrastructure/supabase/repositories/consent-record-repository'

describe('resolveReconfirmationAudience', () => {
  beforeEach(() => vi.clearAllMocks())

  it('passes restaurantId + remainingCap to the repo verbatim', async () => {
    vi.mocked(findReconfirmationAudience).mockResolvedValue([])

    await resolveReconfirmationAudience({
      restaurantId: 'r-1',
      remainingCap: 23,
    })

    expect(findReconfirmationAudience).toHaveBeenCalledWith({
      restaurantId: 'r-1',
      limit: 23,
    })
  })

  it('returns the rows as-is (sorted captured_at DESC by repo)', async () => {
    const rows = [
      { memberId: 'm-1', phoneE164: '85291111111', preferredLanguage: 'en' as const },
      { memberId: 'm-2', phoneE164: '85292222222', preferredLanguage: 'zh_hk' as const },
      { memberId: 'm-3', phoneE164: '85293333333', preferredLanguage: null },
    ]
    vi.mocked(findReconfirmationAudience).mockResolvedValue(rows)

    const out = await resolveReconfirmationAudience({
      restaurantId: 'r-1',
      remainingCap: 50,
    })

    expect(out).toEqual(rows)
  })

  it('returns an empty array immediately when remainingCap is 0 (no DB roundtrip)', async () => {
    const out = await resolveReconfirmationAudience({
      restaurantId: 'r-1',
      remainingCap: 0,
    })
    expect(out).toEqual([])
    expect(findReconfirmationAudience).not.toHaveBeenCalled()
  })

  it('returns an empty array immediately when remainingCap is negative (defensive)', async () => {
    const out = await resolveReconfirmationAudience({
      restaurantId: 'r-1',
      remainingCap: -5,
    })
    expect(out).toEqual([])
    expect(findReconfirmationAudience).not.toHaveBeenCalled()
  })
})
