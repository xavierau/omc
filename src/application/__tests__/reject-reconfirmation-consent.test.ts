// WONB-008 review fix: AC #6 NO must revoke. Tests the use case that backs
// `handleReconfirmationRejection` — only weak+opted_in marketing rows are
// flipped to opted_out; pending / strong / opted_out rows are left alone so
// the WONB-007 rejection handler keeps owning its funnel.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/infrastructure/supabase/repositories/consent-record-repository', () => ({
  findActiveConsent: vi.fn(),
  revokeConsent: vi.fn(),
}))
vi.mock('@/infrastructure/supabase/repositories/member-repository', () => ({
  findMemberByPhone: vi.fn(),
}))
vi.mock('@/application/emit-event', () => ({
  emitEvent: vi.fn(),
}))

import { rejectReconfirmationConsent } from '../reject-reconfirmation-consent'
import {
  findActiveConsent,
  revokeConsent,
} from '@/infrastructure/supabase/repositories/consent-record-repository'
import { findMemberByPhone } from '@/infrastructure/supabase/repositories/member-repository'
import { emitEvent } from '@/application/emit-event'
import { ConsentRecord } from '@/domain/entities/consent-record'
import type {
  ConsentGrade,
  ConsentStatus,
} from '@/domain/value-objects/consent-status'

function buildRecord(
  status: ConsentStatus,
  grade: ConsentGrade
): ConsentRecord {
  return ConsentRecord.fromProps({
    id: 'c-1',
    restaurantId: 'r-1',
    memberId: 'm-1',
    phoneE164: '+85291111111',
    category: 'marketing',
    status,
    consentGrade: grade,
    source: 'csv_import',
    sourceReference: null,
    businessNameShown: null,
    capturedAt: '2026-04-01T00:00:00Z',
    revokedAt: null,
    capturedIp: null,
    capturedUserAgent: null,
    proofUrl: null,
    consentTextShown: null,
    expiresAt: null,
    grantedAt: null,
    importBatchId: null,
  })
}

describe('rejectReconfirmationConsent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(findMemberByPhone).mockResolvedValue({
      id: 'm-1',
      pointsBalance: 0,
      preferredLanguage: null,
    })
    vi.mocked(emitEvent).mockResolvedValue('evt-1')
  })

  it('weak+opted_in row → revokes + emits consent_revoked with reconfirmation source', async () => {
    vi.mocked(findActiveConsent).mockResolvedValue(buildRecord('opted_in', 'weak'))
    vi.mocked(revokeConsent).mockResolvedValue(1)

    const r = await rejectReconfirmationConsent({
      restaurantId: 'r-1',
      phoneE164: '+85291111111',
    })

    expect(r).toEqual({ revoked: true })
    expect(revokeConsent).toHaveBeenCalledWith({
      restaurantId: 'r-1',
      phoneE164: '+85291111111',
      category: 'marketing',
    })
    expect(emitEvent).toHaveBeenCalledWith({
      restaurantId: 'r-1',
      memberId: 'm-1',
      type: 'consent_revoked',
      dataJson: { source: 'reconfirmation_campaign', previousGrade: 'weak' },
    })
  })

  it('pending row → returns false without revoke or event (lets WONB-007 handle pending)', async () => {
    vi.mocked(findActiveConsent).mockResolvedValue(buildRecord('pending', 'strong'))

    const r = await rejectReconfirmationConsent({
      restaurantId: 'r-1',
      phoneE164: '+85291111111',
    })

    expect(r).toEqual({ revoked: false })
    expect(revokeConsent).not.toHaveBeenCalled()
    expect(emitEvent).not.toHaveBeenCalled()
  })

  it('strong+opted_in row → returns false without revoke or event', async () => {
    vi.mocked(findActiveConsent).mockResolvedValue(buildRecord('opted_in', 'strong'))

    const r = await rejectReconfirmationConsent({
      restaurantId: 'r-1',
      phoneE164: '+85291111111',
    })

    expect(r).toEqual({ revoked: false })
    expect(revokeConsent).not.toHaveBeenCalled()
    expect(emitEvent).not.toHaveBeenCalled()
  })

  it('no matching row → returns false without revoke or event', async () => {
    vi.mocked(findActiveConsent).mockResolvedValue(null)

    const r = await rejectReconfirmationConsent({
      restaurantId: 'r-1',
      phoneE164: '+85291111111',
    })

    expect(r).toEqual({ revoked: false })
    expect(revokeConsent).not.toHaveBeenCalled()
    expect(emitEvent).not.toHaveBeenCalled()
  })

  it('returns false when revoke updates zero rows (race with concurrent webhook)', async () => {
    vi.mocked(findActiveConsent).mockResolvedValue(buildRecord('opted_in', 'weak'))
    vi.mocked(revokeConsent).mockResolvedValue(0)

    const r = await rejectReconfirmationConsent({
      restaurantId: 'r-1',
      phoneE164: '+85291111111',
    })

    expect(r).toEqual({ revoked: false })
    expect(emitEvent).not.toHaveBeenCalled()
  })
})
