// Shared contract suite for the `Clock` / `NonceSource` ports. Unlike the
// other three ports in §"Ports with fake + real adapters", both the fake
// (FakeClock/SequenceNonce) and the real (systemClock/systemNonceSource)
// adapters are trivial and available in WI-1 -- so this suite runs against
// both from day one, no later WI needs to add an invocation.
//
// Does NOT end in `.test.ts` -- see `clock-nonce.test.ts` for the invocation.

import { describe, expect, it } from 'vitest'
import type { Clock, NonceSource } from '@/domain/ports/clock'

const NONCE_FORMAT = /^[A-Za-z0-9_-]{16,64}$/

export function runClockContract(label: string, createClock: () => Clock): void {
  describe(`Clock contract (${label})`, () => {
    it('now() returns a valid Date', () => {
      const value = createClock().now()
      expect(value).toBeInstanceOf(Date)
      expect(Number.isFinite(value.getTime())).toBe(true)
    })

    it('is monotonic non-decreasing across sequential reads', () => {
      const clock = createClock()
      const first = clock.now().getTime()
      const second = clock.now().getTime()
      expect(second).toBeGreaterThanOrEqual(first)
    })
  })
}

export function runNonceSourceContract(
  label: string,
  createSource: () => NonceSource
): void {
  describe(`NonceSource contract (${label})`, () => {
    it('next() matches the X-OMC-Nonce format (16-64 chars, [A-Za-z0-9_-])', () => {
      const value = createSource().next()
      expect(value).toMatch(NONCE_FORMAT)
    })

    it('never repeats across many consecutive calls', () => {
      const source = createSource()
      const seen = new Set<string>()
      for (let i = 0; i < 200; i += 1) {
        const value = source.next()
        expect(seen.has(value)).toBe(false)
        seen.add(value)
      }
    })
  })
}
