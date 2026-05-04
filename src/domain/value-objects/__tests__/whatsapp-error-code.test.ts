import { describe, it, expect } from 'vitest'
import { classifyErrorCode } from '../whatsapp-error-code'

// WAQ-003 owns the full §6.1 mapping. Each code in the dispatch table gets
// its own test; the classifier table is the single source of truth that the
// dispatcher (src/application/dispatch-error-action.ts) routes against.

describe('classifyErrorCode — §6.1 dispatch table', () => {
  it('131049 → throttle_recipient_24h / warn (PMM hit)', () => {
    expect(classifyErrorCode('131049')).toEqual({
      code: '131049',
      action: 'throttle_recipient_24h',
      severity: 'warn',
    })
  })

  it('131026 → mark_recipient_unreachable / warn', () => {
    expect(classifyErrorCode('131026')).toEqual({
      code: '131026',
      action: 'mark_recipient_unreachable',
      severity: 'warn',
    })
  })

  it('131045 → block_template / error', () => {
    expect(classifyErrorCode('131045')).toEqual({
      code: '131045',
      action: 'block_template',
      severity: 'error',
    })
  })

  it('131047 → log_only / info (template expired)', () => {
    expect(classifyErrorCode('131047')).toEqual({
      code: '131047',
      action: 'log_only',
      severity: 'info',
    })
  })

  it('131048 → reduce_batch_size / warn', () => {
    expect(classifyErrorCode('131048')).toEqual({
      code: '131048',
      action: 'reduce_batch_size',
      severity: 'warn',
    })
  })

  it('131051 → engineering_alert / error', () => {
    expect(classifyErrorCode('131051')).toEqual({
      code: '131051',
      action: 'engineering_alert',
      severity: 'error',
    })
  })

  it('131056 → backoff_and_retry / warn', () => {
    expect(classifyErrorCode('131056')).toEqual({
      code: '131056',
      action: 'backoff_and_retry',
      severity: 'warn',
    })
  })

  it.each(['132000', '132001', '132100', '132999'])(
    '%s → policy_violation_alert / critical (132xxx prefix)',
    (code) => {
      expect(classifyErrorCode(code)).toEqual({
        code,
        action: 'policy_violation_alert',
        severity: 'critical',
      })
    }
  )

  it('internal_orphan → log_only / warn (preserved from WAQ-001)', () => {
    expect(classifyErrorCode('internal_orphan')).toEqual({
      code: 'internal_orphan',
      action: 'log_only',
      severity: 'warn',
    })
  })

  it('null code → engineering_alert / error (unknown fallback)', () => {
    const result = classifyErrorCode(null)
    expect(result.code).toBe('unknown')
    expect(result.action).toBe('engineering_alert')
    expect(result.severity).toBe('error')
  })

  it('unrecognised string code → engineering_alert / error', () => {
    expect(classifyErrorCode('999999')).toEqual({
      code: '999999',
      action: 'engineering_alert',
      severity: 'error',
    })
  })

  it('does not mis-match codes that merely contain "132" but do not start with it', () => {
    // Defensive: prefix check is startsWith, not includes. A real Meta code
    // is always 6 digits; this guards against future drift if a 7-digit code
    // happens to contain "132" mid-string.
    expect(classifyErrorCode('413200').action).toBe('engineering_alert')
  })
})
