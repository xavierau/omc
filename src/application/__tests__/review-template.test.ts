import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TemplateReview } from '@/domain/entities/template-review'

vi.mock(
  '@/infrastructure/supabase/repositories/template-review-repository',
  () => ({
    findTemplateReviewById: vi.fn(),
    updateTemplateReview: vi.fn().mockResolvedValue(undefined),
  })
)

vi.mock('@/infrastructure/supabase/audit-logger', () => ({
  logAdminAction: vi.fn(),
}))

import { reviewTemplate } from '../review-template'
import { ForbiddenError } from '../forbidden-error'
import {
  findTemplateReviewById,
  updateTemplateReview,
} from '@/infrastructure/supabase/repositories/template-review-repository'
import { logAdminAction } from '@/infrastructure/supabase/audit-logger'

const mockFind = vi.mocked(findTemplateReviewById)
const mockUpdate = vi.mocked(updateTemplateReview)
const mockAudit = vi.mocked(logAdminAction)

const ADMIN_ACTOR = { userId: 'admin-1', role: 'platform_admin' }
const TENANT_ACTOR = { userId: 'user-1', role: 'tenant_user' }

function makePending() {
  return TemplateReview.submit({
    id: 'rev-1',
    restaurantId: 'rest-1',
    templateName: 'promo_summer',
    submittedBy: 'tenant-1',
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockFind.mockResolvedValue(makePending())
})

describe('reviewTemplate — approve', () => {
  it('updates the row to approved and writes an audit log', async () => {
    await reviewTemplate({
      reviewId: 'rev-1',
      action: 'approve',
      actor: ADMIN_ACTOR,
    })

    const persisted = mockUpdate.mock.calls[0][0]
    expect(persisted.snapshot.status).toBe('approved')
    expect(persisted.snapshot.reviewedBy).toBe('admin-1')

    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'admin-1',
        action: 'template_review.approve',
        resourceType: 'template_review_queue',
        resourceId: 'rev-1',
      })
    )
  })

  it('does not require notes for approve', async () => {
    await expect(
      reviewTemplate({ reviewId: 'rev-1', action: 'approve', actor: ADMIN_ACTOR })
    ).resolves.toBeUndefined()
  })
})

describe('reviewTemplate — reject', () => {
  it('updates the row to rejected and audits with notes', async () => {
    await reviewTemplate({
      reviewId: 'rev-1',
      action: 'reject',
      notes: 'misleading content',
      actor: ADMIN_ACTOR,
    })
    expect(mockUpdate.mock.calls[0][0].snapshot.status).toBe('rejected')
    expect(mockAudit.mock.calls[0][0].action).toBe('template_review.reject')
  })

  it('throws when notes are missing for reject', async () => {
    await expect(
      reviewTemplate({ reviewId: 'rev-1', action: 'reject', actor: ADMIN_ACTOR })
    ).rejects.toThrow(/notes/i)
    expect(mockUpdate).not.toHaveBeenCalled()
  })
})

describe('reviewTemplate — request_changes', () => {
  it('updates the row to changes_requested with notes', async () => {
    await reviewTemplate({
      reviewId: 'rev-1',
      action: 'request_changes',
      notes: 'tone down emojis',
      actor: ADMIN_ACTOR,
    })
    expect(mockUpdate.mock.calls[0][0].snapshot.status).toBe('changes_requested')
  })

  it('throws when notes are missing for request_changes', async () => {
    await expect(
      reviewTemplate({
        reviewId: 'rev-1',
        action: 'request_changes',
        actor: ADMIN_ACTOR,
      })
    ).rejects.toThrow(/notes/i)
  })
})

describe('reviewTemplate — auth', () => {
  it('rejects non-platform-admin actor with ForbiddenError', async () => {
    await expect(
      reviewTemplate({ reviewId: 'rev-1', action: 'approve', actor: TENANT_ACTOR })
    ).rejects.toThrow(ForbiddenError)
    expect(mockFind).not.toHaveBeenCalled()
    expect(mockUpdate).not.toHaveBeenCalled()
    expect(mockAudit).not.toHaveBeenCalled()
  })

  it('rejects empty actor.userId', async () => {
    await expect(
      reviewTemplate({
        reviewId: 'rev-1',
        action: 'approve',
        actor: { userId: '', role: 'platform_admin' },
      })
    ).rejects.toThrow(/actor/)
  })
})

describe('reviewTemplate — not found / state checks', () => {
  it('throws when the review does not exist', async () => {
    mockFind.mockResolvedValue(null)
    await expect(
      reviewTemplate({ reviewId: 'rev-X', action: 'approve', actor: ADMIN_ACTOR })
    ).rejects.toThrow(/not found/i)
  })

  it('rejects empty reviewId', async () => {
    await expect(
      reviewTemplate({ reviewId: '', action: 'approve', actor: ADMIN_ACTOR })
    ).rejects.toThrow(/reviewId/)
  })

  it('does not audit when the repo write fails', async () => {
    mockUpdate.mockRejectedValueOnce(new Error('db down'))
    await expect(
      reviewTemplate({ reviewId: 'rev-1', action: 'approve', actor: ADMIN_ACTOR })
    ).rejects.toThrow(/db down/)
    expect(mockAudit).not.toHaveBeenCalled()
  })
})
