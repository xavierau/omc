import type { Clock, NonceSource } from '@/domain/ports/clock'

/** Fake `Clock` -- holds a fixed instant until advanced explicitly. */
export class FakeClock implements Clock {
  private current: Date

  constructor(start: Date = new Date('2026-01-01T00:00:00.000Z')) {
    this.current = start
  }

  now(): Date {
    return this.current
  }

  advanceMs(ms: number): void {
    this.current = new Date(this.current.getTime() + ms)
  }

  set(date: Date): void {
    this.current = date
  }
}

/** Fake `NonceSource` -- returns a deterministic, strictly-incrementing
 * sequence so auth-replay tests can assert on exact values. */
export class SequenceNonce implements NonceSource {
  private counter = 0

  next(): string {
    this.counter += 1
    // Padded to clear the X-OMC-Nonce 16-char minimum regardless of counter width.
    return `test-nonce-${this.counter.toString().padStart(8, '0')}`
  }
}
