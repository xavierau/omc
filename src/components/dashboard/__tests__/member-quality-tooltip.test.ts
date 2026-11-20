import { describe, it, expect } from 'vitest'
import { buildQualityTooltip, clampPage } from '@/components/dashboard/member-detail-helpers'
import { buildMembersQuery } from '@/hooks/use-members'
import type { ContactQuality } from '@/domain/value-objects/contact-quality'

const q = (over: Partial<ContactQuality>): ContactQuality => ({
  rating: 'yellow', deliveryRate: 0.7, sampleSize: 10, reason: 'meets_yellow', ...over,
})

describe('buildQualityTooltip', () => {
  it('unreachable explains the number cannot receive WhatsApp, not a rate', () => {
    expect(buildQualityTooltip(q({ rating: 'red', deliveryRate: 0, sampleSize: 3, reason: 'unreachable' }), 90))
      .toEqual({ key: 'qualityUnreachableTooltip', values: {} })
  })
  it('unreachable with no sample still uses the unreachable copy', () => {
    expect(buildQualityTooltip(q({ rating: 'red', deliveryRate: null, sampleSize: 0, reason: 'unreachable' }), 90).key)
      .toBe('qualityUnreachableTooltip')
  })
  it('no_data names the window', () => {
    expect(buildQualityTooltip(q({ rating: 'unknown', deliveryRate: null, sampleSize: 0, reason: 'no_data' }), 90))
      .toEqual({ key: 'qualityNoDataTooltip', values: { days: 90 } })
  })
  it.each(['meets_green', 'meets_yellow', 'below_yellow'] as const)('%s quotes rate, count and window', (reason) => {
    expect(buildQualityTooltip(q({ reason }), 90)).toEqual({
      key: 'qualityTooltip', values: { rate: 70, count: 10, days: 90 },
    })
  })
})

describe('clampPage', () => {
  it('steps back to the last page when the current one emptied', () => {
    expect(clampPage(3, 2)).toBe(2)
  })
  it('keeps a valid page', () => {
    expect(clampPage(2, 2)).toBe(2)
    expect(clampPage(1, 5)).toBe(1)
  })
  it('leaves page alone when there are no pages (empty state handles it)', () => {
    expect(clampPage(1, 0)).toBe(1)
    expect(clampPage(4, 0)).toBe(4)
  })
})

describe('buildMembersQuery include=quality', () => {
  const base = { page: 1, sortBy: 'last_visit_at', sortOrder: 'desc' }
  it('sends include=quality only when asked', () => {
    expect(new URLSearchParams(buildMembersQuery({ ...base, includeQuality: true })).get('include')).toBe('quality')
    expect(new URLSearchParams(buildMembersQuery(base)).has('include')).toBe(false)
  })
})
