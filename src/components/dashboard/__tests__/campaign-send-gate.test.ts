import { describe, it, expect } from 'vitest'
import {
  formatExecuteViolations,
  readExecuteError,
  reviewGateReasonKey,
} from '@/components/dashboard/campaign-send-gate'

const FALLBACK = "Couldn't send this campaign."

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('formatExecuteViolations', () => {
  it('passes through plain string violations', () => {
    expect(formatExecuteViolations(['Monthly limit reached'])).toEqual(['Monthly limit reached'])
  })

  it('extracts message from object violations', () => {
    expect(formatExecuteViolations([{ code: 'MONTHLY_LIMIT', message: 'Monthly limit reached' }])).toEqual([
      'Monthly limit reached',
    ])
  })

  it('falls back to code when an object violation has no message', () => {
    expect(formatExecuteViolations([{ code: 'MONTHLY_LIMIT' }])).toEqual(['MONTHLY_LIMIT'])
  })

  it('handles a mix of string and object violations', () => {
    expect(
      formatExecuteViolations(['Daily cap hit', { code: 'X', message: 'Template blocked' }])
    ).toEqual(['Daily cap hit', 'Template blocked'])
  })

  it('drops empty entries', () => {
    expect(formatExecuteViolations([{}])).toEqual([])
  })

  it('returns an empty array when violations is undefined', () => {
    expect(formatExecuteViolations(undefined)).toEqual([])
  })
})

describe('readExecuteError', () => {
  it('joins violation messages when present', async () => {
    const res = jsonResponse(403, {
      error: 'Campaign blocked by guardrails',
      violations: ['Daily cap hit', { code: 'X', message: 'Template blocked' }],
    })
    expect(await readExecuteError(res, FALLBACK)).toBe('Daily cap hit; Template blocked')
  })

  it('falls back to the top-level error when there are no violations', async () => {
    const res = jsonResponse(400, { error: 'Campaign must be active to execute' })
    expect(await readExecuteError(res, FALLBACK)).toBe('Campaign must be active to execute')
  })

  it('falls back to the generic message when the body explains nothing', async () => {
    const res = jsonResponse(500, {})
    expect(await readExecuteError(res, FALLBACK)).toBe(FALLBACK)
  })

  it('falls back to the generic message when the body is not JSON', async () => {
    const res = new Response('<html>Bad Gateway</html>', { status: 502 })
    expect(await readExecuteError(res, FALLBACK)).toBe(FALLBACK)
  })
})

describe('reviewGateReasonKey', () => {
  it('returns null when the gate is not required', () => {
    expect(reviewGateReasonKey({ required: false, status: 'none' })).toBeNull()
  })

  it('returns null when no gate is supplied', () => {
    expect(reviewGateReasonKey(undefined)).toBeNull()
    expect(reviewGateReasonKey(null)).toBeNull()
  })

  it('returns null when required and approved', () => {
    expect(reviewGateReasonKey({ required: true, status: 'approved' })).toBeNull()
  })

  it('returns the pending key when required and pending', () => {
    expect(reviewGateReasonKey({ required: true, status: 'pending' })).toBe('reviewRequiredPending')
  })

  it('returns the submit key when required and none', () => {
    expect(reviewGateReasonKey({ required: true, status: 'none' })).toBe('reviewRequiredSubmit')
  })

  it('returns the submit key when required and rejected', () => {
    expect(reviewGateReasonKey({ required: true, status: 'rejected' })).toBe('reviewRequiredSubmit')
  })

  it('returns the submit key when required and changes_requested', () => {
    expect(reviewGateReasonKey({ required: true, status: 'changes_requested' })).toBe(
      'reviewRequiredSubmit'
    )
  })
})
