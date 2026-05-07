import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/infrastructure/supabase/repositories/consent-record-repository', () => ({
  upgradeGradeToStrong: vi.fn(),
}))
vi.mock('@/infrastructure/supabase/repositories/member-repository', () => ({
  findMemberByPhone: vi.fn(),
}))
vi.mock('@/application/emit-event', () => ({
  emitEvent: vi.fn(),
}))

import { confirmReconfirmationConsent } from '../confirm-reconfirmation-consent'
import { upgradeGradeToStrong } from '@/infrastructure/supabase/repositories/consent-record-repository'
import { findMemberByPhone } from '@/infrastructure/supabase/repositories/member-repository'
import { emitEvent } from '@/application/emit-event'

describe('confirmReconfirmationConsent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(findMemberByPhone).mockResolvedValue({
      id: 'm-1',
      pointsBalance: 0,
      preferredLanguage: null,
    })
    vi.mocked(emitEvent).mockResolvedValue('evt-1')
  })

  it('upgrades weak → strong and emits consent_granted with previousGrade=weak', async () => {
    vi.mocked(upgradeGradeToStrong).mockResolvedValue(true)

    const r = await confirmReconfirmationConsent({
      restaurantId: 'r-1',
      phoneE164: '85291111111',
    })

    expect(r).toEqual({ upgraded: true })
    expect(upgradeGradeToStrong).toHaveBeenCalledWith({
      restaurantId: 'r-1',
      phoneE164: '85291111111',
      category: 'marketing',
    })
    expect(emitEvent).toHaveBeenCalledWith({
      restaurantId: 'r-1',
      memberId: 'm-1',
      type: 'consent_granted',
      dataJson: { source: 'reconfirmation_campaign', previousGrade: 'weak' },
    })
  })

  it('returns upgraded=false and skips event when no weak+opted_in row matched (idempotent)', async () => {
    vi.mocked(upgradeGradeToStrong).mockResolvedValue(false)

    const r = await confirmReconfirmationConsent({
      restaurantId: 'r-1',
      phoneE164: '85291111111',
    })

    expect(r).toEqual({ upgraded: false })
    expect(emitEvent).not.toHaveBeenCalled()
  })

  it('still emits the event when the member lookup misses (memberId=null)', async () => {
    vi.mocked(upgradeGradeToStrong).mockResolvedValue(true)
    vi.mocked(findMemberByPhone).mockResolvedValue(null)

    const r = await confirmReconfirmationConsent({
      restaurantId: 'r-1',
      phoneE164: '85291111111',
    })

    expect(r).toEqual({ upgraded: true })
    expect(emitEvent).toHaveBeenCalledWith({
      restaurantId: 'r-1',
      memberId: null,
      type: 'consent_granted',
      dataJson: { source: 'reconfirmation_campaign', previousGrade: 'weak' },
    })
  })

  it('does not throw when repo returns false repeatedly (already-strong, idempotent)', async () => {
    vi.mocked(upgradeGradeToStrong).mockResolvedValue(false)

    await expect(
      confirmReconfirmationConsent({ restaurantId: 'r-1', phoneE164: '852' })
    ).resolves.toEqual({ upgraded: false })
    await expect(
      confirmReconfirmationConsent({ restaurantId: 'r-1', phoneE164: '852' })
    ).resolves.toEqual({ upgraded: false })
  })
})
