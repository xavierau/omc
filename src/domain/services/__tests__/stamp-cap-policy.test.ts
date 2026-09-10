import { describe, it, expect } from 'vitest'
import { evaluateStampCapPolicy } from '../stamp-cap-policy'

const OFF = { enforcement: 'off' as const, warnThreshold: 1 }
const WARN = { enforcement: 'warn' as const, warnThreshold: 1 }
const BLOCK = { enforcement: 'block' as const, warnThreshold: 1 }

describe('evaluateStampCapPolicy', () => {
  it('allows silently when value is at or below the threshold (any enforcement)', () => {
    expect(evaluateStampCapPolicy(1, WARN)).toEqual({ allowed: true })
    expect(evaluateStampCapPolicy(1, BLOCK)).toEqual({ allowed: true })
    expect(evaluateStampCapPolicy(1, OFF)).toEqual({ allowed: true })
  })

  it("off: allows silently even above the threshold (no warning)", () => {
    expect(evaluateStampCapPolicy(5, OFF)).toEqual({ allowed: true })
  })

  it('warn: allows above the threshold but returns the abuse-risk warning', () => {
    const result = evaluateStampCapPolicy(3, WARN)
    expect(result.allowed).toBe(true)
    expect(result.warning).toContain('forwarded-screenshot')
  })

  it('block: rejects above the threshold with a plan-limit error', () => {
    const result = evaluateStampCapPolicy(3, BLOCK)
    expect(result.allowed).toBe(false)
    expect(result.error).toContain('1')
  })

  it('respects a raised threshold: value == threshold is allowed; value > threshold engages', () => {
    const policy = { enforcement: 'block' as const, warnThreshold: 3 }
    expect(evaluateStampCapPolicy(3, policy)).toEqual({ allowed: true })
    expect(evaluateStampCapPolicy(4, policy).allowed).toBe(false)
  })
})
