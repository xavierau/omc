import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock(
  '@/infrastructure/supabase/repositories/template-review-repository',
  () => ({
    insertTemplateReview: vi.fn().mockResolvedValue(undefined),
  })
)

import { submitTemplateReview } from '../submit-template-review'
import { insertTemplateReview } from '@/infrastructure/supabase/repositories/template-review-repository'

const mockInsert = vi.mocked(insertTemplateReview)

beforeEach(() => mockInsert.mockClear())

describe('submitTemplateReview', () => {
  const VALID = {
    restaurantId: 'rest-1',
    templateName: 'promo_summer',
    submittedBy: 'tenant-user-1',
  }

  it('inserts a pending review and returns the row id', async () => {
    const id = await submitTemplateReview(VALID)
    expect(typeof id).toBe('string')
    expect(id.length).toBeGreaterThan(0)
    expect(mockInsert).toHaveBeenCalledTimes(1)
    const submitted = mockInsert.mock.calls[0][0]
    expect(submitted.snapshot.restaurantId).toBe('rest-1')
    expect(submitted.snapshot.templateName).toBe('promo_summer')
    expect(submitted.snapshot.status).toBe('pending')
    expect(submitted.snapshot.submittedBy).toBe('tenant-user-1')
    expect(submitted.snapshot.id).toBe(id)
  })

  it('passes through optional fields', async () => {
    await submitTemplateReview({
      ...VALID,
      templateId: 'tmpl-1',
      targetAudienceSize: 250,
      targetAudienceQuery: { tier: 'gold' },
      contentPreview: 'Get 20% off',
    })
    const submitted = mockInsert.mock.calls[0][0]
    expect(submitted.snapshot.templateId).toBe('tmpl-1')
    expect(submitted.snapshot.targetAudienceSize).toBe(250)
    expect(submitted.snapshot.contentPreview).toBe('Get 20% off')
  })

  it('rejects empty restaurantId via the entity validator', async () => {
    await expect(
      submitTemplateReview({ ...VALID, restaurantId: '' })
    ).rejects.toThrow(/restaurantId/)
    expect(mockInsert).not.toHaveBeenCalled()
  })

  it('rejects empty templateName', async () => {
    await expect(
      submitTemplateReview({ ...VALID, templateName: '   ' })
    ).rejects.toThrow(/templateName/)
  })

  it('rejects empty submittedBy', async () => {
    await expect(
      submitTemplateReview({ ...VALID, submittedBy: '' })
    ).rejects.toThrow(/submittedBy/)
  })
})
