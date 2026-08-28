import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/infrastructure/supabase/repositories/import-preview-lookups', () => ({
  findExistingMemberPhones: vi.fn(),
  findActiveMarketingConsentPhones: vi.fn(),
}))

import {
  findExistingMemberPhones,
  findActiveMarketingConsentPhones,
} from '@/infrastructure/supabase/repositories/import-preview-lookups'
import {
  runPreviewLookups,
  PREVIEW_LOOKUP_MAX_ROWS,
} from '../preview-contacts-batch-lookups'

const RESTAURANT_ID = 'rest-1'

beforeEach(() => vi.clearAllMocks())

describe('runPreviewLookups', () => {
  it('composes the two sets into arrays with status ok (T-B5.1)', async () => {
    vi.mocked(findExistingMemberPhones).mockResolvedValue(new Set(['+85291234567']))
    vi.mocked(findActiveMarketingConsentPhones).mockResolvedValue(new Set())

    const result = await runPreviewLookups(RESTAURANT_ID, ['+85291234567', '+85299999999'])

    expect(result).toEqual({
      alreadyMemberPhones: ['+85291234567'],
      activeConsentPhones: [],
      status: 'ok',
    })
  })

  it('passes restaurantId and phones through to both repository calls', async () => {
    vi.mocked(findExistingMemberPhones).mockResolvedValue(new Set())
    vi.mocked(findActiveMarketingConsentPhones).mockResolvedValue(new Set())

    await runPreviewLookups(RESTAURANT_ID, ['+85291234567'])

    expect(findExistingMemberPhones).toHaveBeenCalledWith(RESTAURANT_ID, ['+85291234567'])
    expect(findActiveMarketingConsentPhones).toHaveBeenCalledWith(RESTAURANT_ID, ['+85291234567'])
  })

  it('returns status ok with empty sets and issues no query for an empty phones list (T-B5.8)', async () => {
    const result = await runPreviewLookups(RESTAURANT_ID, [])

    expect(result).toEqual({ alreadyMemberPhones: [], activeConsentPhones: [], status: 'ok' })
    expect(findExistingMemberPhones).not.toHaveBeenCalled()
    expect(findActiveMarketingConsentPhones).not.toHaveBeenCalled()
  })

  it('degrades to skipped_too_many_rows above PREVIEW_LOOKUP_MAX_ROWS without querying (T-B5.5)', async () => {
    const phones = Array.from({ length: PREVIEW_LOOKUP_MAX_ROWS + 1 }, (_, i) => `+852${i}`)

    const result = await runPreviewLookups(RESTAURANT_ID, phones)

    expect(result).toEqual({
      alreadyMemberPhones: [],
      activeConsentPhones: [],
      status: 'skipped_too_many_rows',
    })
    expect(findExistingMemberPhones).not.toHaveBeenCalled()
    expect(findActiveMarketingConsentPhones).not.toHaveBeenCalled()
  })

  it('exactly at the cap still runs the lookups', async () => {
    const phones = Array.from({ length: PREVIEW_LOOKUP_MAX_ROWS }, (_, i) => `+852${i}`)
    vi.mocked(findExistingMemberPhones).mockResolvedValue(new Set())
    vi.mocked(findActiveMarketingConsentPhones).mockResolvedValue(new Set())

    const result = await runPreviewLookups(RESTAURANT_ID, phones)

    expect(result.status).toBe('ok')
    expect(findExistingMemberPhones).toHaveBeenCalled()
  })

  it('degrades to failed and logs when a repository call throws (T-B5.7, AD-5)', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(findExistingMemberPhones).mockRejectedValue(new Error('db down'))
    vi.mocked(findActiveMarketingConsentPhones).mockResolvedValue(new Set())

    const result = await runPreviewLookups(RESTAURANT_ID, ['+85291234567'])

    expect(result).toEqual({ alreadyMemberPhones: [], activeConsentPhones: [], status: 'failed' })
    expect(errorSpy).toHaveBeenCalled()
    errorSpy.mockRestore()
  })
})
