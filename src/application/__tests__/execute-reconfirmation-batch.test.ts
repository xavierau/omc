import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Campaign } from '@/domain/entities/campaign'
import type { Member } from '@/domain/entities/member'
import type { WhatsAppTemplate } from '@/domain/entities/whatsapp-template'
import { ConsentRecord } from '@/domain/entities/consent-record'

vi.mock('@/application/execute-campaign-batch', () => ({
  sendInBatches: vi.fn(),
}))
vi.mock('@/infrastructure/supabase/repositories/consent-record-repository', () => ({
  findActiveMarketingConsentForPhones: vi.fn(),
}))

import { executeReconfirmationBatch } from '../execute-reconfirmation-batch'
import { sendInBatches } from '@/application/execute-campaign-batch'
import { findActiveMarketingConsentForPhones } from '@/infrastructure/supabase/repositories/consent-record-repository'
import { ReconfirmationTemplateError } from '@/domain/services/__errors__/reconfirmation-errors'

function buildTemplate(
  overrides: Partial<WhatsAppTemplate> = {}
): WhatsAppTemplate {
  return {
    id: 'tpl-1',
    restaurantId: 'r-1',
    metaTemplateId: 'meta-1',
    name: 'reconfirm_legacy',
    language: 'en',
    category: 'UTILITY',
    status: 'approved',
    components: [],
    parameterFormat: 'NAMED',
    rejectionReason: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

function buildCampaign(overrides: Partial<Campaign> = {}): Campaign {
  return {
    id: 'c-1',
    restaurantId: 'r-1',
    name: 'Reconfirm legacy',
    type: 'promo',
    template: '',
    templateEn: 'Reply YES to keep getting our updates.',
    templateZhHk: '回覆 YES 繼續收到我們的更新。',
    imageUrlEn: null,
    imageUrlZhHk: null,
    couponConfig: null,
    schedule: null,
    scheduledAt: null,
    status: 'active',
    mode: 'reconfirmation',
    isChargeable: false,
    chargeableSentCount: 0,
    nonChargeableSentCount: 0,
    redeemedCount: 0,
    whatsappTemplateId: 'tpl-1',
    targetAudience: 'all',
    createdAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

function buildMember(overrides: Partial<Member> = {}): Member {
  return {
    id: 'm-1',
    restaurantId: 'r-1',
    phone: '85291111111',
    name: 'Alice',
    pointsBalance: 0,
    status: 'active',
    joinedAt: '2026-01-01T00:00:00Z',
    lastVisitAt: null,
    preferredLanguage: null,
    pmmThrottledUntil: null,
    unreachableAt: null,
    ...overrides,
  }
}

function consentRow(args: {
  phone: string
  grade?: 'weak' | 'strong' | 'pending' | 'none'
  status?: 'opted_in' | 'pending' | 'opted_out'
}): ConsentRecord {
  return ConsentRecord.grant({
    id: `cr-${args.phone}`,
    restaurantId: 'r-1',
    memberId: null,
    phoneE164: args.phone,
    category: 'marketing',
    source: 'pre-system migration',
    grade: (args.grade ?? 'weak') as 'weak' | 'strong' | 'none',
  })
}

function buildCtx(template: WhatsAppTemplate) {
  return {
    campaign: buildCampaign(),
    phoneNumberId: 'phone-id-1',
    template,
    restaurantDefaultLanguage: 'en' as string | null,
    trackingEnabled: false,
    perUserMarketingCap: 1,
    pacingConfig: {
      strategy: 'naive' as const,
      probeChunkSize: 100,
      scaleChunkSize: 100,
      activeHoursStartLocal: '00:00:00',
      activeHoursEndLocal: '23:59:59',
      tenantTimezone: 'Asia/Hong_Kong',
    },
  }
}

describe('executeReconfirmationBatch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(sendInBatches).mockResolvedValue(undefined)
  })

  it('throws ReconfirmationTemplateError(not_utility) when template is MARKETING', async () => {
    const ctx = buildCtx(buildTemplate({ category: 'MARKETING' }))

    await expect(
      executeReconfirmationBatch({ members: [buildMember()], ctx })
    ).rejects.toBeInstanceOf(ReconfirmationTemplateError)
    await expect(
      executeReconfirmationBatch({ members: [buildMember()], ctx })
    ).rejects.toMatchObject({ reason: 'not_utility' })
    expect(sendInBatches).not.toHaveBeenCalled()
  })

  it('throws ReconfirmationTemplateError(not_utility) when template is null', async () => {
    const ctx = { ...buildCtx(buildTemplate()), template: null }

    await expect(
      executeReconfirmationBatch({ members: [buildMember()], ctx })
    ).rejects.toBeInstanceOf(ReconfirmationTemplateError)
    expect(sendInBatches).not.toHaveBeenCalled()
  })

  it('passes through members whose consent is still weak+opted_in', async () => {
    const ctx = buildCtx(buildTemplate())
    const m1 = buildMember({ id: 'm-1', phone: '85291111111' })
    const m2 = buildMember({ id: 'm-2', phone: '85292222222' })
    vi.mocked(findActiveMarketingConsentForPhones).mockResolvedValue(
      new Map([
        [m1.phone, consentRow({ phone: m1.phone, grade: 'weak' })],
        [m2.phone, consentRow({ phone: m2.phone, grade: 'weak' })],
      ])
    )

    await executeReconfirmationBatch({ members: [m1, m2], ctx })

    expect(sendInBatches).toHaveBeenCalledTimes(1)
    expect(sendInBatches).toHaveBeenCalledWith([m1, m2], ctx)
  })

  it('skips a row whose consent is no longer weak (concurrently upgraded to strong)', async () => {
    const ctx = buildCtx(buildTemplate())
    const m1 = buildMember({ id: 'm-1', phone: '85291111111' })
    const m2 = buildMember({ id: 'm-2', phone: '85292222222' })
    vi.mocked(findActiveMarketingConsentForPhones).mockResolvedValue(
      new Map([
        [m1.phone, consentRow({ phone: m1.phone, grade: 'weak' })],
        [m2.phone, consentRow({ phone: m2.phone, grade: 'strong' })],
      ])
    )
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await executeReconfirmationBatch({ members: [m1, m2], ctx })

    expect(sendInBatches).toHaveBeenCalledTimes(1)
    expect(sendInBatches).toHaveBeenCalledWith([m1], ctx)
    // Skip is logged (ops needs to see concurrent-mutation skips).
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('skips a row whose consent is missing (concurrent revoke / opted_out)', async () => {
    const ctx = buildCtx(buildTemplate())
    const m1 = buildMember({ id: 'm-1', phone: '85291111111' })
    const m2 = buildMember({ id: 'm-2', phone: '85292222222' })
    // m2 is absent from the map → consent gone (opted_out) since the
    // audience query ran. Defence-in-depth must catch it.
    vi.mocked(findActiveMarketingConsentForPhones).mockResolvedValue(
      new Map([[m1.phone, consentRow({ phone: m1.phone, grade: 'weak' })]])
    )
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await executeReconfirmationBatch({ members: [m1, m2], ctx })

    expect(sendInBatches).toHaveBeenCalledWith([m1], ctx)
    warn.mockRestore()
  })

  it('does not call sendInBatches when every row fails the per-row recheck', async () => {
    const ctx = buildCtx(buildTemplate())
    const m1 = buildMember({ id: 'm-1', phone: '85291111111' })
    vi.mocked(findActiveMarketingConsentForPhones).mockResolvedValue(
      new Map([[m1.phone, consentRow({ phone: m1.phone, grade: 'strong' })]])
    )
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await executeReconfirmationBatch({ members: [m1], ctx })

    expect(sendInBatches).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it('returns immediately on empty input without consulting the consent gate', async () => {
    const ctx = buildCtx(buildTemplate())

    await executeReconfirmationBatch({ members: [], ctx })

    expect(findActiveMarketingConsentForPhones).not.toHaveBeenCalled()
    expect(sendInBatches).not.toHaveBeenCalled()
  })

  it('caps the batch at the daily allotment (slices by dailyAllotment when supplied)', async () => {
    const ctx = buildCtx(buildTemplate())
    const m1 = buildMember({ id: 'm-1', phone: '85291111111' })
    const m2 = buildMember({ id: 'm-2', phone: '85292222222' })
    const m3 = buildMember({ id: 'm-3', phone: '85293333333' })
    vi.mocked(findActiveMarketingConsentForPhones).mockResolvedValue(
      new Map([
        [m1.phone, consentRow({ phone: m1.phone, grade: 'weak' })],
        [m2.phone, consentRow({ phone: m2.phone, grade: 'weak' })],
        [m3.phone, consentRow({ phone: m3.phone, grade: 'weak' })],
      ])
    )

    await executeReconfirmationBatch({
      members: [m1, m2, m3],
      ctx,
      dailyAllotment: 2,
    })

    // Only the first 2 reach sendInBatches even though all 3 are eligible.
    expect(sendInBatches).toHaveBeenCalledWith([m1, m2], ctx)
  })
})
