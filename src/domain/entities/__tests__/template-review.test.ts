import { describe, it, expect } from 'vitest'
import { TemplateReview } from '../template-review'

const BASE_INPUT = {
  id: 'rev-1',
  restaurantId: 'rest-1',
  templateId: 'tmpl-1',
  templateName: 'promo_summer',
  targetAudienceSize: 250,
  targetAudienceQuery: { tier: 'gold' },
  contentPreview: 'Get 20% off!',
  submittedBy: 'tenant-user-1',
}

describe('TemplateReview.submit', () => {
  it('creates a pending review with submitted_at timestamp', () => {
    const review = TemplateReview.submit(BASE_INPUT)
    const s = review.snapshot
    expect(s.status).toBe('pending')
    expect(s.id).toBe('rev-1')
    expect(s.restaurantId).toBe('rest-1')
    expect(s.templateName).toBe('promo_summer')
    expect(s.submittedBy).toBe('tenant-user-1')
    expect(s.submittedAt).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
    )
    expect(s.reviewedBy).toBeNull()
    expect(s.reviewedAt).toBeNull()
    expect(s.reviewNotes).toBeNull()
  })

  it('passes through optional fields', () => {
    const review = TemplateReview.submit(BASE_INPUT)
    expect(review.snapshot.targetAudienceSize).toBe(250)
    expect(review.snapshot.targetAudienceQuery).toEqual({ tier: 'gold' })
    expect(review.snapshot.contentPreview).toBe('Get 20% off!')
    expect(review.snapshot.templateId).toBe('tmpl-1')
  })

  it('allows null/undefined optional fields', () => {
    const review = TemplateReview.submit({
      id: 'rev-2',
      restaurantId: 'rest-1',
      templateName: 'promo_x',
      submittedBy: 'tenant-user-1',
    })
    const s = review.snapshot
    expect(s.templateId).toBeNull()
    expect(s.targetAudienceSize).toBeNull()
    expect(s.targetAudienceQuery).toBeNull()
    expect(s.contentPreview).toBeNull()
  })

  it('rejects empty templateName', () => {
    expect(() =>
      TemplateReview.submit({ ...BASE_INPUT, templateName: '' })
    ).toThrow(/templateName/)
  })

  it('rejects empty restaurantId', () => {
    expect(() =>
      TemplateReview.submit({ ...BASE_INPUT, restaurantId: '   ' })
    ).toThrow(/restaurantId/)
  })

  it('rejects empty submittedBy', () => {
    expect(() =>
      TemplateReview.submit({ ...BASE_INPUT, submittedBy: '' })
    ).toThrow(/submittedBy/)
  })
})

describe('TemplateReview.approve', () => {
  it('transitions pending to approved with reviewer + notes', () => {
    const pending = TemplateReview.submit(BASE_INPUT)
    const approved = pending.approve('admin-1', 'looks good')
    expect(approved.snapshot.status).toBe('approved')
    expect(approved.snapshot.reviewedBy).toBe('admin-1')
    expect(approved.snapshot.reviewNotes).toBe('looks good')
    expect(approved.snapshot.reviewedAt).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
    )
  })

  it('approval notes are optional', () => {
    const pending = TemplateReview.submit(BASE_INPUT)
    const approved = pending.approve('admin-1')
    expect(approved.snapshot.status).toBe('approved')
    expect(approved.snapshot.reviewNotes).toBeNull()
  })

  it('does not mutate the original entity (immutable transition)', () => {
    const pending = TemplateReview.submit(BASE_INPUT)
    pending.approve('admin-1')
    expect(pending.snapshot.status).toBe('pending')
  })

  it('cannot approve a rejected review', () => {
    const pending = TemplateReview.submit(BASE_INPUT)
    const rejected = pending.reject('admin-1', 'no')
    expect(() => rejected.approve('admin-2')).toThrow(/pending/i)
  })

  it('cannot approve an already approved review', () => {
    const pending = TemplateReview.submit(BASE_INPUT)
    const approved = pending.approve('admin-1')
    expect(() => approved.approve('admin-2')).toThrow(/pending/i)
  })

  it('rejects empty reviewer id', () => {
    const pending = TemplateReview.submit(BASE_INPUT)
    expect(() => pending.approve('   ')).toThrow(/reviewer/i)
  })
})

describe('TemplateReview.reject', () => {
  it('transitions pending to rejected with reviewer + required notes', () => {
    const pending = TemplateReview.submit(BASE_INPUT)
    const rejected = pending.reject('admin-1', 'misleading content')
    expect(rejected.snapshot.status).toBe('rejected')
    expect(rejected.snapshot.reviewedBy).toBe('admin-1')
    expect(rejected.snapshot.reviewNotes).toBe('misleading content')
    expect(rejected.snapshot.reviewedAt).toMatch(/T/)
  })

  it('requires non-empty notes', () => {
    const pending = TemplateReview.submit(BASE_INPUT)
    expect(() => pending.reject('admin-1', '')).toThrow(/notes/i)
    expect(() => pending.reject('admin-1', '   ')).toThrow(/notes/i)
  })

  it('cannot reject an already rejected review', () => {
    const pending = TemplateReview.submit(BASE_INPUT)
    const rejected = pending.reject('admin-1', 'no')
    expect(() => rejected.reject('admin-2', 'still no')).toThrow(/pending/i)
  })

  it('cannot reject an approved review', () => {
    const pending = TemplateReview.submit(BASE_INPUT)
    const approved = pending.approve('admin-1')
    expect(() => approved.reject('admin-2', 'changed mind')).toThrow(/pending/i)
  })
})

describe('TemplateReview.requestChanges', () => {
  it('transitions pending to changes_requested with required notes', () => {
    const pending = TemplateReview.submit(BASE_INPUT)
    const changes = pending.requestChanges('admin-1', 'tone down emojis')
    expect(changes.snapshot.status).toBe('changes_requested')
    expect(changes.snapshot.reviewedBy).toBe('admin-1')
    expect(changes.snapshot.reviewNotes).toBe('tone down emojis')
  })

  it('requires non-empty notes', () => {
    const pending = TemplateReview.submit(BASE_INPUT)
    expect(() => pending.requestChanges('admin-1', '')).toThrow(/notes/i)
  })

  it('cannot requestChanges from approved', () => {
    const pending = TemplateReview.submit(BASE_INPUT)
    const approved = pending.approve('admin-1')
    expect(() => approved.requestChanges('admin-2', 'oops')).toThrow(/pending/i)
  })
})

describe('TemplateReview.fromProps', () => {
  it('reconstructs an entity from row data without re-running validation', () => {
    const review = TemplateReview.fromProps({
      id: 'rev-1',
      restaurantId: 'rest-1',
      templateId: null,
      templateName: 'promo_summer',
      targetAudienceSize: null,
      targetAudienceQuery: null,
      contentPreview: null,
      status: 'approved',
      submittedBy: 'tenant-user-1',
      submittedAt: '2026-04-01T00:00:00.000Z',
      reviewedBy: 'admin-1',
      reviewedAt: '2026-04-02T00:00:00.000Z',
      reviewNotes: null,
    })
    expect(review.snapshot.status).toBe('approved')
    expect(review.snapshot.reviewedAt).toBe('2026-04-02T00:00:00.000Z')
  })
})
