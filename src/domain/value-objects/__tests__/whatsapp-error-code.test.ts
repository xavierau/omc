import { describe, it, expect } from 'vitest'
import { classifyErrorCode } from '../whatsapp-error-code'

// FIX 5 (review round 1): lock in the WAQ-001 contract for the partial
// error-code table. WAQ-003 owns the full §6.1 mapping; if these tests
// fail in WAQ-003 because new entries were added, that is the right
// signal to update the test, not the production code.

describe('classifyErrorCode', () => {
  it('classifies internal_orphan as log_only / warn (addendum §6.4)', () => {
    expect(classifyErrorCode('internal_orphan')).toEqual({
      code: 'internal_orphan',
      action: 'log_only',
      severity: 'warn',
    })
  })

  it('falls back to engineering_alert for null code (unknown)', () => {
    // The implementation normalizes null -> 'unknown'. Locking this in
    // documents the contract; if WAQ-003 changes the fallback name, the
    // test surfaces it explicitly.
    const result = classifyErrorCode(null)
    expect(result.code).toBe('unknown')
    expect(result.action).toBe('engineering_alert')
    expect(result.severity).toBe('error')
  })

  it('falls back to engineering_alert for codes WAQ-003 has not classified yet (e.g. 131049)', () => {
    // 131049 is a known Meta error code that WAQ-003 will eventually map
    // to throttle_recipient_24h. WAQ-001 only ships the partial table,
    // so this code goes through the default branch today. When WAQ-003
    // populates the full mapping, the assertion below will start failing
    // — that is the signal to update this test.
    const result = classifyErrorCode('131049')
    expect(result.action).toBe('engineering_alert')
    expect(result.severity).toBe('error')
  })
})
