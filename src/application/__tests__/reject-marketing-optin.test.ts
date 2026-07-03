import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock(
  '@/infrastructure/supabase/repositories/optin-template-repository',
  () => ({
    findRecentPendingMarketingConsent: vi.fn(),
  })
)
vi.mock('@/infrastructure/supabase/repositories/consent-record-repository', () => ({
  revokeConsent: vi.fn(),
}))
vi.mock('@/infrastructure/supabase/repositories/member-repository', () => ({
  findMemberByPhone: vi.fn(),
}))
vi.mock('@/application/emit-event', () => ({
  emitEvent: vi.fn(),
}))

import { rejectMarketingOptin } from '../reject-marketing-optin'
import { findRecentPendingMarketingConsent } from '@/infrastructure/supabase/repositories/optin-template-repository'
import { revokeConsent } from '@/infrastructure/supabase/repositories/consent-record-repository'
import { findMemberByPhone } from '@/infrastructure/supabase/repositories/member-repository'
import { emitEvent } from '@/application/emit-event'
import { ConsentRecord } from '@/domain/entities/consent-record'

const PENDING = ConsentRecord.markPending({
  id: 'c-pending',
  restaurantId: 'r-1',
  memberId: 'm-1',
  phoneE164: '85291111111',
  category: 'marketing',
  source: 'inbound_first_optin',
})

describe('rejectMarketingOptin', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(findMemberByPhone).mockResolvedValue({
      id: 'm-1',
      pointsBalance: 0,
      preferredLanguage: null,
    })
    vi.mocked(emitEvent).mockResolvedValue('evt-1')
  })

  it('revokes the pending row and emits consent_revoked', async () => {
    vi.mocked(findRecentPendingMarketingConsent).mockResolvedValue(PENDING)
    vi.mocked(revokeConsent).mockResolvedValue(1)

    const r = await rejectMarketingOptin({
      restaurantId: 'r-1',
      phoneE164: '85291111111',
    })

    expect(r).toEqual({ revoked: true })
    expect(revokeConsent).toHaveBeenCalledWith({
      restaurantId: 'r-1',
      phoneE164: '85291111111',
      category: 'marketing',
    })
    expect(emitEvent).toHaveBeenCalledWith({
      restaurantId: 'r-1',
      memberId: 'm-1',
      type: 'consent_revoked',
      dataJson: { source: 'inbound_first_optin_rejected' },
    })
  })

  it('returns revoked=false and skips both the revoke and the event when no pending row exists', async () => {
    vi.mocked(findRecentPendingMarketingConsent).mockResolvedValue(null)

    const r = await rejectMarketingOptin({
      restaurantId: 'r-1',
      phoneE164: '85291111111',
    })

    expect(r).toEqual({ revoked: false })
    expect(revokeConsent).not.toHaveBeenCalled()
    expect(emitEvent).not.toHaveBeenCalled()
  })

  it('returns revoked=false when revoke updates zero rows (race with concurrent webhook)', async () => {
    vi.mocked(findRecentPendingMarketingConsent).mockResolvedValue(PENDING)
    vi.mocked(revokeConsent).mockResolvedValue(0)

    const r = await rejectMarketingOptin({
      restaurantId: 'r-1',
      phoneE164: '85291111111',
    })

    expect(r).toEqual({ revoked: false })
    expect(emitEvent).not.toHaveBeenCalled()
  })
})
