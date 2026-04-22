import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/infrastructure/flowforge/client')
vi.mock('@/infrastructure/supabase/repositories/receipt-repository')
vi.mock('@/infrastructure/supabase/repositories/restaurant-repository')
vi.mock('@/infrastructure/supabase/repositories/member-repository')
vi.mock('@/infrastructure/supabase/repositories/restaurant-onboarding-repository')
vi.mock('@/infrastructure/whatsapp/messaging')
vi.mock('@/infrastructure/supabase/client')
vi.mock('@/application/award-points')
vi.mock('@/application/validate-receipt')
vi.mock('@/application/verify-receipt-layout')

import { submitReceiptExtraction } from '@/infrastructure/flowforge/client'
import { createReceipt, updateReceipt } from '@/infrastructure/supabase/repositories/receipt-repository'
import { getRestaurantPhoneNumberId } from '@/infrastructure/supabase/repositories/restaurant-repository'
import { getMemberPreferredLanguage } from '@/infrastructure/supabase/repositories/member-repository'
import { getRestaurantDefaultLanguage } from '@/infrastructure/supabase/repositories/restaurant-onboarding-repository'
import { sendTextMessage } from '@/infrastructure/whatsapp/messaging'
import { awardPoints } from '@/application/award-points'
import { validateReceipt } from '@/application/validate-receipt'
import { verifyReceiptLayout } from '@/application/verify-receipt-layout'
import { processReceipt, handleParseResult, confirmReceipt } from '../process-receipt'
import type { ParsedReceipt } from '@/domain/interfaces/parsed-receipt'

function makeParsed(overrides: Partial<ParsedReceipt> = {}): ParsedReceipt {
  return {
    total: 200,
    items: [{ name: 'Dinner', price: 200 }],
    confidence: 0.95,
    currency: 'HKD',
    receiptNumber: 'RN-100',
    merchantName: 'Test Place',
    tamperAssessment: null,
    ...overrides,
  }
}

const BASE_PARAMS = {
  receiptId: 'rec-1',
  memberId: 'm-1',
  restaurantId: 'rest-1',
  phoneNumberId: 'pn-1',
  phone: '+85291234567',
  parsed: makeParsed(),
}

describe('handleParseResult', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(updateReceipt).mockResolvedValue(undefined as never)
    vi.mocked(sendTextMessage).mockResolvedValue(undefined)
    vi.mocked(awardPoints).mockResolvedValue(undefined)
    vi.mocked(validateReceipt).mockResolvedValue({ valid: true })
    vi.mocked(verifyReceiptLayout).mockResolvedValue(undefined)
    vi.mocked(getMemberPreferredLanguage).mockResolvedValue(null)
    vi.mocked(getRestaurantDefaultLanguage).mockResolvedValue('en')
  })

  it('rejects when confidence is 0', async () => {
    const parsed = makeParsed({ confidence: 0 })

    await handleParseResult({ ...BASE_PARAMS, parsed })

    expect(updateReceipt).toHaveBeenCalledWith('rec-1', expect.objectContaining({ status: 'rejected' }))
    expect(sendTextMessage).toHaveBeenCalledWith('pn-1', '+85291234567', expect.stringContaining("couldn't read"))
    expect(awardPoints).not.toHaveBeenCalled()
  })

  it('rejects when total is 0', async () => {
    const parsed = makeParsed({ total: 0 })

    await handleParseResult({ ...BASE_PARAMS, parsed })

    expect(updateReceipt).toHaveBeenCalledWith('rec-1', expect.objectContaining({ status: 'rejected' }))
    expect(awardPoints).not.toHaveBeenCalled()
  })

  it('rejects when validation fails with reason=tamper (EN)', async () => {
    vi.mocked(validateReceipt).mockResolvedValue({ valid: false, reason: 'tamper' })

    await handleParseResult(BASE_PARAMS)

    expect(updateReceipt).toHaveBeenCalledWith('rec-1', expect.objectContaining({ status: 'rejected' }))
    expect(sendTextMessage).toHaveBeenCalledWith(
      'pn-1',
      '+85291234567',
      expect.stringContaining('modified')
    )
    expect(awardPoints).not.toHaveBeenCalled()
  })

  it('ZH member: rejects with ZH tamper message', async () => {
    vi.mocked(validateReceipt).mockResolvedValue({ valid: false, reason: 'tamper' })
    vi.mocked(getMemberPreferredLanguage).mockResolvedValue('zh_hk')

    await handleParseResult(BASE_PARAMS)

    expect(sendTextMessage).toHaveBeenCalledWith(
      'pn-1',
      '+85291234567',
      expect.stringContaining('修改')
    )
  })

  it('ZH member: rejects with ZH duplicate message', async () => {
    vi.mocked(validateReceipt).mockResolvedValue({ valid: false, reason: 'duplicate' })
    vi.mocked(getMemberPreferredLanguage).mockResolvedValue('zh_hk')

    await handleParseResult(BASE_PARAMS)

    expect(sendTextMessage).toHaveBeenCalledWith(
      'pn-1',
      '+85291234567',
      expect.stringContaining('已提交')
    )
  })

  it('ZH member: rejects with ZH wrong-merchant message', async () => {
    vi.mocked(validateReceipt).mockResolvedValue({ valid: false, reason: 'wrong_merchant' })
    vi.mocked(getMemberPreferredLanguage).mockResolvedValue('zh_hk')

    await handleParseResult(BASE_PARAMS)

    expect(sendTextMessage).toHaveBeenCalledWith(
      'pn-1',
      '+85291234567',
      expect.stringMatching(/非本店|非.*收據/)
    )
  })

  it('ZH member: confirmation prompt uses ZH copy', async () => {
    const parsed = makeParsed({ confidence: 0.5, total: 150 })
    vi.mocked(getMemberPreferredLanguage).mockResolvedValue('zh_hk')

    await handleParseResult({ ...BASE_PARAMS, parsed })

    expect(sendTextMessage).toHaveBeenCalledWith(
      'pn-1',
      '+85291234567',
      expect.stringContaining('$150')
    )
    expect(sendTextMessage).toHaveBeenCalledWith(
      'pn-1',
      '+85291234567',
      expect.stringContaining('金額')
    )
  })

  it('ZH member: unreadable-receipt reply uses ZH copy', async () => {
    const parsed = makeParsed({ confidence: 0 })
    vi.mocked(getMemberPreferredLanguage).mockResolvedValue('zh_hk')

    await handleParseResult({ ...BASE_PARAMS, parsed })

    expect(sendTextMessage).toHaveBeenCalledWith(
      'pn-1',
      '+85291234567',
      expect.stringContaining('無法讀取')
    )
  })

  it('awards points when confidence >= 0.8', async () => {
    const parsed = makeParsed({ confidence: 0.85 })

    await handleParseResult({ ...BASE_PARAMS, parsed })

    expect(awardPoints).toHaveBeenCalledWith(
      expect.objectContaining({ receiptId: 'rec-1', amount: 200 })
    )
  })

  it('requests confirmation when confidence < 0.8', async () => {
    const parsed = makeParsed({ confidence: 0.5, total: 150 })

    await handleParseResult({ ...BASE_PARAMS, parsed })

    expect(updateReceipt).toHaveBeenCalledWith('rec-1', expect.objectContaining({ status: 'pending_confirmation' }))
    expect(sendTextMessage).toHaveBeenCalledWith('pn-1', '+85291234567', expect.stringContaining('$150'))
    expect(awardPoints).not.toHaveBeenCalled()
  })

  it('does not throw when layout verification fails', async () => {
    vi.mocked(verifyReceiptLayout).mockRejectedValue(new Error('layout service down'))
    const parsed = makeParsed({ confidence: 0.9 })

    await expect(
      handleParseResult({ ...BASE_PARAMS, parsed, imageUrl: 'https://img.test/r.jpg' })
    ).resolves.not.toThrow()
  })
})

describe('processReceipt', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(createReceipt).mockResolvedValue('rec-new' as never)
    vi.mocked(updateReceipt).mockResolvedValue(undefined as never)
    vi.mocked(submitReceiptExtraction).mockResolvedValue('job-123')
    vi.mocked(getRestaurantPhoneNumberId).mockResolvedValue('pn-1')
    vi.mocked(sendTextMessage).mockResolvedValue(undefined)
    vi.mocked(getMemberPreferredLanguage).mockResolvedValue(null)
    vi.mocked(getRestaurantDefaultLanguage).mockResolvedValue('en')
  })

  it('creates receipt and submits to FlowForge', async () => {
    await processReceipt('rest-1', 'm-1', '+852912', 'https://img/r.jpg')

    expect(createReceipt).toHaveBeenCalledWith(
      expect.objectContaining({ memberId: 'm-1', status: 'processing' })
    )
    expect(submitReceiptExtraction).toHaveBeenCalled()
    expect(updateReceipt).toHaveBeenCalledWith('rec-new', { flowforge_job_id: 'job-123' })
  })

  it('marks rejected and notifies on FlowForge error', async () => {
    vi.mocked(submitReceiptExtraction).mockRejectedValue(new Error('timeout'))

    await processReceipt('rest-1', 'm-1', '+852912', 'https://img/r.jpg')

    expect(updateReceipt).toHaveBeenCalledWith('rec-new', { status: 'rejected' })
    expect(sendTextMessage).toHaveBeenCalledWith('pn-1', '+852912', expect.stringContaining('error processing'))
  })
})

describe('confirmReceipt', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getRestaurantPhoneNumberId).mockResolvedValue('pn-1')
    vi.mocked(awardPoints).mockResolvedValue(undefined)
    vi.mocked(getMemberPreferredLanguage).mockResolvedValue(null)
    vi.mocked(getRestaurantDefaultLanguage).mockResolvedValue('en')
  })

  it('fetches phoneNumberId and awards points with confirmed amount', async () => {
    const mockSupabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: { items_json: [], confidence: 0.5 },
              error: null,
            }),
          }),
        }),
      }),
    }
    const { createServerSupabaseClient } = await import('@/infrastructure/supabase/client')
    vi.mocked(createServerSupabaseClient).mockReturnValue(mockSupabase as never)

    await confirmReceipt('m-1', 'rest-1', '+852912', 'rec-1', 250)

    expect(getRestaurantPhoneNumberId).toHaveBeenCalledWith('rest-1')
    expect(awardPoints).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 250, receiptId: 'rec-1' })
    )
  })

  it('ZH member: forwards Language.ZH_HK to awardPoints', async () => {
    vi.mocked(getMemberPreferredLanguage).mockResolvedValue('zh_hk')
    const mockSupabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: { items_json: [], confidence: 0.5 },
              error: null,
            }),
          }),
        }),
      }),
    }
    const { createServerSupabaseClient } = await import('@/infrastructure/supabase/client')
    vi.mocked(createServerSupabaseClient).mockReturnValue(mockSupabase as never)

    await confirmReceipt('m-1', 'rest-1', '+852912', 'rec-1', 100)

    const call = vi.mocked(awardPoints).mock.calls[0][0] as unknown as { language: { code: string } }
    expect(call.language.code).toBe('zh_hk')
  })
})
