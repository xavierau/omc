import { describe, it, expect } from 'vitest'
import { buildCampaign } from '@/test-utils/builders'

// Campaign is a plain TS interface (no factory). The test surface is the
// shape itself — the test-utils builder is the canonical default factory.
// WONB-008 adds `mode: 'marketing' | 'reconfirmation'` with a 'marketing'
// default so existing callers stay backward-compatible.

describe('Campaign entity (WONB-008 mode field)', () => {
  it("defaults mode to 'marketing' for backward compat", () => {
    const c = buildCampaign()
    expect(c.mode).toBe('marketing')
  })

  it("accepts mode='reconfirmation' via override", () => {
    const c = buildCampaign({ mode: 'reconfirmation' })
    expect(c.mode).toBe('reconfirmation')
  })

  it('keeps mode in the shape so the union narrows correctly', () => {
    const c = buildCampaign({ mode: 'reconfirmation' })
    // Compile-time narrow check: assigning back must remain in-union.
    const m: 'marketing' | 'reconfirmation' = c.mode
    expect(['marketing', 'reconfirmation']).toContain(m)
  })
})
