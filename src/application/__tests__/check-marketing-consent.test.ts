import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/infrastructure/supabase/repositories/consent-record-repository', () => ({
  findActiveConsent: vi.fn(),
  findActiveMarketingConsentForPhones: vi.fn(),
}))

import {
  checkMarketingConsent,
  bulkCheckMarketingConsent,
} from '../check-marketing-consent'
import {
  findActiveConsent,
  findActiveMarketingConsentForPhones,
} from '@/infrastructure/supabase/repositories/consent-record-repository'
import { ConsentRecord } from '@/domain/entities/consent-record'

describe('checkMarketingConsent', () => {
  beforeEach(() => vi.clearAllMocks())

  it('rejects with no_consent when no active record exists', async () => {
    vi.mocked(findActiveConsent).mockResolvedValue(null)

    const r = await checkMarketingConsent({
      restaurantId: 'r-1',
      phoneE164: '85291234567',
    })
    expect(r).toEqual({ allowed: false, reason: 'no_consent' })
    expect(findActiveConsent).toHaveBeenCalledWith({
      restaurantId: 'r-1',
      phoneE164: '85291234567',
      category: 'marketing',
    })
  })

  it('allows opted_in records and returns the consent grade', async () => {
    const granted = ConsentRecord.grant({
      id: 'cr-1',
      restaurantId: 'r-1',
      memberId: 'm-1',
      phoneE164: '85291234567',
      category: 'marketing',
      source: 'website_form',
      grade: 'strong',
    })
    vi.mocked(findActiveConsent).mockResolvedValue(granted)

    const r = await checkMarketingConsent({
      restaurantId: 'r-1',
      phoneE164: '85291234567',
    })
    expect(r).toEqual({ allowed: true, grade: 'strong' })
  })

  it('reports the weak grade for backfilled records', async () => {
    const granted = ConsentRecord.grant({
      id: 'cr-1',
      restaurantId: 'r-1',
      memberId: 'm-1',
      phoneE164: '85291234567',
      category: 'marketing',
      source: 'pre-system migration',
      grade: 'weak',
    })
    vi.mocked(findActiveConsent).mockResolvedValue(granted)

    const r = await checkMarketingConsent({
      restaurantId: 'r-1',
      phoneE164: '85291234567',
    })
    expect(r).toEqual({ allowed: true, grade: 'weak' })
  })

  it('rejects with pending when the record is awaiting double-opt-in', async () => {
    const pending = ConsentRecord.markPending({
      id: 'cr-2',
      restaurantId: 'r-1',
      memberId: null,
      phoneE164: '85299999999',
      category: 'marketing',
      source: 'whatsapp_keyword',
    })
    vi.mocked(findActiveConsent).mockResolvedValue(pending)

    const r = await checkMarketingConsent({
      restaurantId: 'r-1',
      phoneE164: '85299999999',
    })
    expect(r).toEqual({ allowed: false, reason: 'pending' })
  })

  it('defensively rejects opted_out (should not surface from findActive but guards if it ever does)', async () => {
    // Construct an opted_out record by granting then revoking it. findActive
    // is contractually filter-bound to opted_in/pending, but the gate is a
    // last line of defence and must not allow a stray opted_out to send.
    const revoked = ConsentRecord.grant({
      id: 'cr-3',
      restaurantId: 'r-1',
      memberId: null,
      phoneE164: '85291234567',
      category: 'marketing',
      source: 'website_form',
    }).revoke(new Date('2026-05-04T12:00:00.000Z'))
    vi.mocked(findActiveConsent).mockResolvedValue(revoked)

    const r = await checkMarketingConsent({
      restaurantId: 'r-1',
      phoneE164: '85291234567',
    })
    expect(r).toEqual({ allowed: false, reason: 'opted_out' })
  })
})

describe('bulkCheckMarketingConsent', () => {
  beforeEach(() => vi.clearAllMocks())

  it('issues exactly ONE repository call for the whole batch (regression: no N+1)', async () => {
    vi.mocked(findActiveMarketingConsentForPhones).mockResolvedValue(new Map())

    await bulkCheckMarketingConsent({
      restaurantId: 'r-1',
      phones: ['85291111111', '85292222222', '85293333333'],
    })

    expect(findActiveMarketingConsentForPhones).toHaveBeenCalledTimes(1)
    expect(findActiveMarketingConsentForPhones).toHaveBeenCalledWith({
      restaurantId: 'r-1',
      phones: ['85291111111', '85292222222', '85293333333'],
    })
  })

  it('returns an entry per requested phone, mapping decision per the same rules as the per-phone gate', async () => {
    const opted = ConsentRecord.grant({
      id: 'cr-1',
      restaurantId: 'r-1',
      memberId: 'm-1',
      phoneE164: '85291111111',
      category: 'marketing',
      source: 'website_form',
      grade: 'strong',
    })
    const pending = ConsentRecord.markPending({
      id: 'cr-2',
      restaurantId: 'r-1',
      memberId: null,
      phoneE164: '85292222222',
      category: 'marketing',
      source: 'whatsapp_keyword',
    })
    const revoked = ConsentRecord.grant({
      id: 'cr-3',
      restaurantId: 'r-1',
      memberId: null,
      phoneE164: '85293333333',
      category: 'marketing',
      source: 'website_form',
    }).revoke(new Date('2026-05-04T12:00:00.000Z'))

    vi.mocked(findActiveMarketingConsentForPhones).mockResolvedValue(
      new Map([
        ['85291111111', opted],
        ['85292222222', pending],
        ['85293333333', revoked],
      ])
    )

    const map = await bulkCheckMarketingConsent({
      restaurantId: 'r-1',
      phones: [
        '85291111111',
        '85292222222',
        '85293333333',
        '85294444444', // no row at all
      ],
    })

    // Every requested phone is present so callers don't need null-checks.
    expect(map.size).toBe(4)
    expect(map.get('85291111111')).toEqual({ allowed: true, grade: 'strong' })
    expect(map.get('85292222222')).toEqual({ allowed: false, reason: 'pending' })
    expect(map.get('85293333333')).toEqual({
      allowed: false,
      reason: 'opted_out',
    })
    expect(map.get('85294444444')).toEqual({
      allowed: false,
      reason: 'no_consent',
    })
  })

  it('short-circuits with an empty input — no repo call, empty map', async () => {
    const map = await bulkCheckMarketingConsent({
      restaurantId: 'r-1',
      phones: [],
    })
    expect(map.size).toBe(0)
    expect(findActiveMarketingConsentForPhones).not.toHaveBeenCalled()
  })
})
