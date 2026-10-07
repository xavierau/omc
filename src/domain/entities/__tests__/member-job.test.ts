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

  it('failed -> { status, error } only, verbatim for a known/safe error code', () => {
    const job = MemberJob.fromProps(
      baseProps({ status: 'failed', error: { code: 'tenant_inactive', message: 'tenant_inactive' } })
    )
    expect(job.partnerView()).toEqual({
      status: 'failed',
      error: { code: 'tenant_inactive', message: 'tenant_inactive' },
    })
  })

  // #6 (WI-17, confirmation review, grok): `code: 'internal'` marks a
  // caught, untyped exception -- its message is whatever the underlying
  // Postgres/driver/JS error said (I-3 redacts a phone-shaped run, nothing
  // else). This assertion PROVES WRONG the pre-#6-fix behaviour the old
  // 'failed -> { status, error } only' test asserted (verbatim passthrough
  // of `message: 'boom'` for code:'internal') -- that test has been
  // narrowed above to a known-safe code, and this block covers the
  // code:'internal' case the fix actually changes.
  describe('#6: code:\'internal\' never echoes the raw caught-exception message to the partner', () => {
    it('a raw internal error message (containing a phone and stack-like text) is replaced with the fixed generic string', () => {
      const job = MemberJob.fromProps(
        baseProps({
          status: 'failed',
          error: {
            code: 'internal',
            message: 'insert into "members" ... duplicate key value (phone)=(***4567)\n    at Object.query (/app/pg.js:42:11)',
          },
        })
      )
      const view = job.partnerView()
      expect(view).toEqual({
        status: 'failed',
        error: { code: 'internal', message: 'An internal error occurred while processing this request.' },
      })
      expect(JSON.stringify(view)).not.toMatch(/4567|pg\.js|at Object/)
    })

    it('the underlying raw message is still readable from the entity\'s own snapshot (server-side / owner-dashboard use, NOT stripped at the source)', () => {
      const job = MemberJob.fromProps(
        baseProps({ status: 'failed', error: { code: 'internal', message: 'raw db error text' } })
      )
      expect(job.snapshot.error).toEqual({ code: 'internal', message: 'raw db error text' })
      // ...but partnerView() -- the ONLY partner-facing shape -- is generic.
      expect((job.partnerView() as { error: { message: string } }).error.message).toBe(
        'An internal error occurred while processing this request.'
      )
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
