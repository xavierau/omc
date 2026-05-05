import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/infrastructure/supabase/repositories/consent-record-repository', () => ({
  upgradeToOptedIn: vi.fn(),
}))
vi.mock('@/infrastructure/supabase/repositories/member-repository', () => ({
  findMemberByPhone: vi.fn(),
}))
vi.mock('@/application/emit-event', () => ({
  emitEvent: vi.fn(),
}))

import { confirmMarketingOptin } from '../confirm-marketing-optin'
import { upgradeToOptedIn } from '@/infrastructure/supabase/repositories/consent-record-repository'
import { findMemberByPhone } from '@/infrastructure/supabase/repositories/member-repository'
import { emitEvent } from '@/application/emit-event'

describe('confirmMarketingOptin', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(findMemberByPhone).mockResolvedValue({
      id: 'm-1',
      pointsBalance: 0,
      preferredLanguage: null,
    })
    vi.mocked(emitEvent).mockResolvedValue('evt-1')
  })

  it('upgrades pending → opted_in and emits consent_granted', async () => {
    vi.mocked(upgradeToOptedIn).mockResolvedValue(true)

    const r = await confirmMarketingOptin({
      restaurantId: 'r-1',
      phoneE164: '85291111111',
    })

    expect(r).toEqual({ upgraded: true })
    expect(upgradeToOptedIn).toHaveBeenCalledWith({
      restaurantId: 'r-1',
      phoneE164: '85291111111',
      category: 'marketing',
    })
    expect(emitEvent).toHaveBeenCalledWith({
      restaurantId: 'r-1',
      memberId: 'm-1',
      type: 'consent_granted',
      dataJson: { source: 'inbound_first_optin' },
    })
  })

  it('returns upgraded=false and skips the event when no pending row was upgraded (idempotent)', async () => {
    vi.mocked(upgradeToOptedIn).mockResolvedValue(false)

    const r = await confirmMarketingOptin({
      restaurantId: 'r-1',
      phoneE164: '85291111111',
    })

    expect(r).toEqual({ upgraded: false })
    expect(emitEvent).not.toHaveBeenCalled()
  })

  it('still emits the event even when the member lookup misses (memberId=null)', async () => {
    vi.mocked(upgradeToOptedIn).mockResolvedValue(true)
    vi.mocked(findMemberByPhone).mockResolvedValue(null)

    const r = await confirmMarketingOptin({
      restaurantId: 'r-1',
      phoneE164: '85291111111',
    })

    expect(r).toEqual({ upgraded: true })
    expect(emitEvent).toHaveBeenCalledWith({
      restaurantId: 'r-1',
      memberId: null,
      type: 'consent_granted',
      dataJson: { source: 'inbound_first_optin' },
    })
  })
})
