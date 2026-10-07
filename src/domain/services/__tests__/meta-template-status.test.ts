import { describe, it, expect } from 'vitest'
import {
  mapMetaTemplateStatus,
  SYNCABLE_STATUSES,
  NO_REJECTION_REASON,
} from '../meta-template-status'

describe('mapMetaTemplateStatus', () => {
  it('maps APPROVED to approved', () => {
    expect(mapMetaTemplateStatus('APPROVED')).toBe('approved')
  })

  it('maps REJECTED to rejected', () => {
    expect(mapMetaTemplateStatus('REJECTED')).toBe('rejected')
  })

  it('maps PENDING to pending', () => {
    expect(mapMetaTemplateStatus('PENDING')).toBe('pending')
  })

  it('maps PAUSED to paused', () => {
    expect(mapMetaTemplateStatus('PAUSED')).toBe('paused')
  })

  it('maps DISABLED to disabled', () => {
    expect(mapMetaTemplateStatus('DISABLED')).toBe('disabled')
  })

  it('returns null for unknown statuses', () => {
    expect(mapMetaTemplateStatus('IN_APPEAL')).toBeNull()
    expect(mapMetaTemplateStatus('FLAGGED')).toBeNull()
  })

  it('is case-sensitive — does not lowercase-normalise', () => {
    expect(mapMetaTemplateStatus('approved')).toBeNull()
    expect(mapMetaTemplateStatus('Approved')).toBeNull()
  })
})

describe('SYNCABLE_STATUSES', () => {
  it('contains exactly pending, approved, paused', () => {
    expect(SYNCABLE_STATUSES).toEqual(['pending', 'approved', 'paused'])
  })
})

describe('NO_REJECTION_REASON', () => {
  it('is the default rejection reason constant', () => {
    expect(NO_REJECTION_REASON).toBe('Rejected by Meta (no reason provided)')
  })
})
