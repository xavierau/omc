// INT-001 T-C2: the only phone representation allowed to reach idempotency,
// member lookup, consent and the outbound payload on the partner API path.
// Construction is a strict format assertion only -- normalisation (format
// variants -> canonical E.164) happens upstream in
// `src/infrastructure/phone/e164-parser.ts`, which is the sole caller
// expected to hand this constructor an already-normalised string.

const E164_PATTERN = /^\+[1-9]\d{7,14}$/

export class E164Phone {
  readonly value: string

  private constructor(value: string) {
    this.value = value
  }

  /** Asserts `value` is already a well-formed E.164 string. Throws otherwise. */
  static of(value: string): E164Phone {
    if (typeof value !== 'string' || !E164_PATTERN.test(value)) {
      throw new Error('E164Phone: value is not a valid E.164 number')
    }
    return new E164Phone(value)
  }

  get last4(): string {
    return this.value.slice(-4)
  }

  equals(other: E164Phone): boolean {
    return this.value === other.value
  }
}
