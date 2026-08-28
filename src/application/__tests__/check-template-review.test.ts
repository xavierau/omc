import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TemplateReview } from '@/domain/entities/template-review'

vi.mock('../check-tenant-trust', () => ({
  isTenantTrusted: vi.fn(),
}))

vi.mock(
  '@/infrastructure/supabase/repositories/template-review-repository',
  () => ({
    findActiveTemplateReviewByName: vi.fn(),
  })
)

import { checkTemplateReview } from '../check-template-review'
import { isTenantTrusted } from '../check-tenant-trust'
import { findActiveTemplateReviewByName } from '@/infrastructure/supabase/repositories/template-review-repository'

const mockTrust = vi.mocked(isTenantTrusted)
const mockFind = vi.mocked(findActiveTemplateReviewByName)

const ARGS = { restaurantId: 'rest-1', templateName: 'promo_summer' }

beforeEach(() => vi.clearAllMocks())

describe('checkTemplateReview', () => {
  it('allows trusted tenants without consulting the queue', async () => {
    mockTrust.mockResolvedValue({ trusted: true })
    const result = await checkTemplateReview(ARGS)
    expect(result.allowed).toBe(true)
    expect(mockFind).not.toHaveBeenCalled()
  })

  it('allows untrusted tenant with an APPROVED review row', async () => {
    mockTrust.mockResolvedValue({ trusted: false, reason: 'too_new' })
    const review = TemplateReview.submit({
      id: 'rev-1',
      restaurantId: 'rest-1',
      templateName: 'promo_summer',
      submittedBy: 'tenant-1',
    }).approve('admin-1')
    mockFind.mockResolvedValue(review)

    const result = await checkTemplateReview(ARGS)
    expect(result.allowed).toBe(true)
  })

  it('denies untrusted tenant with a PENDING review (not yet approved)', async () => {
    mockTrust.mockResolvedValue({ trusted: false, reason: 'too_new' })
    const pending = TemplateReview.submit({
      id: 'rev-1',
      restaurantId: 'rest-1',
      templateName: 'promo_summer',
      submittedBy: 'tenant-1',
    })
    mockFind.mockResolvedValue(pending)

    const result = await checkTemplateReview(ARGS)
    expect(result.allowed).toBe(false)
    expect(result.reason).toBe('template_review_required')
  })

  it('denies untrusted tenant with NO active review row', async () => {
    mockTrust.mockResolvedValue({ trusted: false, reason: 'too_new' })
    mockFind.mockResolvedValue(null)

    const result = await checkTemplateReview(ARGS)
    expect(result.allowed).toBe(false)
    expect(result.reason).toBe('template_review_required')
  })

  it('passes the restaurantId/templateName through to the repo lookup', async () => {
    mockTrust.mockResolvedValue({ trusted: false, reason: 'too_new' })
    mockFind.mockResolvedValue(null)
    await checkTemplateReview(ARGS)
    expect(mockFind).toHaveBeenCalledWith({
      restaurantId: 'rest-1',
      templateName: 'promo_summer',
    })
  })

  it('surfaces the trust reason on denial for diagnostics', async () => {
    mockTrust.mockResolvedValue({ trusted: false, reason: 'auto_paused' })
    mockFind.mockResolvedValue(null)
    const result = await checkTemplateReview(ARGS)
    expect(result.allowed).toBe(false)
    expect(result.trustReason).toBe('auto_paused')
  })

  it('rejects empty restaurantId', async () => {
    await expect(
      checkTemplateReview({ restaurantId: '', templateName: 'x' })
    ).rejects.toThrow(/restaurantId/)
  })

  it('rejects empty templateName', async () => {
    await expect(
      checkTemplateReview({ restaurantId: 'rest-1', templateName: '' })
    ).rejects.toThrow(/templateName/)
  })
})
