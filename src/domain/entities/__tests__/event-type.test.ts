import { describe, it, expect } from 'vitest'
import type { EventType } from '../event'

// Compile-time guard: if `stamp` / `stamp_reversal` were not added to the
// EventType union, these annotated assignments would fail typecheck (the build
// gate). The runtime expectations keep the test executable under vitest.
describe('EventType union — stamp collection (migration 050)', () => {
  it('includes stamp as a valid member', () => {
    const t: EventType = 'stamp'
    expect(t).toBe('stamp')
  })

  it('includes stamp_reversal as a valid member', () => {
    const t: EventType = 'stamp_reversal'
    expect(t).toBe('stamp_reversal')
  })

  it('still includes the consent_* + onboarding baseline types (no regression)', () => {
    const baseline: EventType[] = [
      'onboarding_phase_advanced',
      'consent_imported',
      'consent_granted',
      'consent_revoked',
      'consent_expired',
    ]
    expect(baseline).toHaveLength(5)
  })
})
