import { describe, expect, it } from 'vitest'
import { MemberJob, type MemberJobProps } from '../member-job'

function baseProps(overrides: Partial<MemberJobProps> = {}): MemberJobProps {
  return {
    jobId: 'mj_1',
    integrationId: 'int-1',
    restaurantId: 'r-1',
    status: 'queued',
    outcome: null,
    memberId: null,
    error: null,
    assertedLevel: 'all',
    consentActions: null,
    welcomeOutcome: null,
    welcomeDetail: null,
    attempts: 0,
    submittedAt: '2026-09-10T00:00:00.000Z',
    startedAt: null,
    completedAt: null,
    resultExpiresAt: null,
    ...overrides,
  }
}

describe('MemberJob.partnerView (OD-11)', () => {
  it('queued -> { status, submitted_at, attempts } only', () => {
    const job = MemberJob.fromProps(baseProps({ status: 'queued', attempts: 0 }))
    expect(job.partnerView()).toEqual({
      status: 'queued',
      submitted_at: '2026-09-10T00:00:00.000Z',
      attempts: 0,
    })
  })

  it('processing -> { status, submitted_at, attempts } only', () => {
    const job = MemberJob.fromProps(baseProps({ status: 'processing', attempts: 1 }))
    expect(job.partnerView()).toEqual({
      status: 'processing',
      submitted_at: '2026-09-10T00:00:00.000Z',
      attempts: 1,
    })
  })

  it('succeeded -> { status, member_id, outcome } only -- no coupon/consent/welcome fields', () => {
    const job = MemberJob.fromProps(
      baseProps({
        status: 'succeeded',
        memberId: 'm-1',
        outcome: 'created',
        consentActions: { marketing: 'inserted' },
        welcomeOutcome: 'queued',
        assertedLevel: 'all',
      })
    )
    const view = job.partnerView()
    expect(view).toEqual({ status: 'succeeded', member_id: 'm-1', outcome: 'created' })
    expect(JSON.stringify(view)).not.toMatch(/consent|welcome|coupon|level/i)
  })

  it('failed -> { status, error } only', () => {
    const job = MemberJob.fromProps(
      baseProps({ status: 'failed', error: { code: 'internal', message: 'boom' } })
    )
    expect(job.partnerView()).toEqual({
      status: 'failed',
      error: { code: 'internal', message: 'boom' },
    })
  })

  it('throws (never silently omits) if succeeded is missing memberId/outcome', () => {
    const job = MemberJob.fromProps(baseProps({ status: 'succeeded' }))
    expect(() => job.partnerView()).toThrow()
  })

  it('throws if failed is missing an error', () => {
    const job = MemberJob.fromProps(baseProps({ status: 'failed' }))
    expect(() => job.partnerView()).toThrow()
  })
})

describe('MemberJob.isExpired', () => {
  it('false when resultExpiresAt is null', () => {
    const job = MemberJob.fromProps(baseProps({ resultExpiresAt: null }))
    expect(job.isExpired(new Date('2099-01-01T00:00:00.000Z'))).toBe(false)
  })

  it('true once now is past resultExpiresAt', () => {
    const job = MemberJob.fromProps(baseProps({ resultExpiresAt: '2026-09-10T01:00:00.000Z' }))
    expect(job.isExpired(new Date('2026-09-10T02:00:00.000Z'))).toBe(true)
    expect(job.isExpired(new Date('2026-09-10T00:00:00.000Z'))).toBe(false)
  })
})
