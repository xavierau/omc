// INT-001 WI-16 (G-3, grok review): fast-check property suite over the
// LEGACY `PhoneNumber` VO's own accepted grammar (WhatsApp join + web QR
// join paths), per the dispatch brief's explicit acceptance criterion:
// "every string [the old VO] accepts must either normalise through the
// seam or fall back to the legacy behaviour -- never an unhandled throw /
// 500."
//
// `PhoneNumber.create` (src/domain/value-objects/phone-number.ts) strips
// only `[\s\-()]`, prefixes `+` if missing, and accepts anything whose
// DIGIT COUNT (ignoring every other character) is 8-15 -- so its accepted
// grammar is far wider than E.164: it tolerates dots, letters, and other
// punctuation riding along inside `.value`, and imposes no leading-digit
// restriction (a run starting with `0` is accepted).
//
// This suite generates strings within THAT grammar and asserts
// `resolveLegacyMemberE164` (register-member.ts / register-member-web.ts)
// never throws anything OTHER than the recognised `Invalid phone number:`
// shape both callers' existing error handling already understands (the
// web join route's `message.includes('Invalid phone')` -> 400 mapping,
// and the WhatsApp handler's catch-all).

import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { PhoneNumber } from '@/domain/value-objects/phone-number'
import { E164Phone } from '@/domain/value-objects/e164-phone'
import { resolveLegacyMemberE164 as resolveWhatsappLegacyE164 } from '@/application/register-member'
import { resolveLegacyMemberE164 as resolveWebLegacyE164 } from '@/application/register-member-web'

const digitsArb = fc
  .array(fc.integer({ min: 0, max: 9 }), { minLength: 8, maxLength: 15 })
  .map((digits) => digits.join(''))

// Characters `PhoneNumber.create` tolerates riding along inside `.value`
// (anything outside `[\s\-()]`) -- a mix of what `parseE164Phone`'s own
// pre-filter allows (`.`) and what it rejects (letters, `#`, `*`).
const noiseCharArb = fc.constantFrom('.', 'x', 'A', '#', '*', 'z')

/** A digit run (8-15 digits, PhoneNumber's own length grammar), optionally
 * with ONE noise character spliced in at a random position, optionally
 * `+`-prefixed. Covers: clean digit runs (happy path), dotted runs
 * (should resolve via parseE164Phone), letter/symbol-noised runs (the
 * residual gap this suite exists to catch), and leading-zero runs (E164Phone
 * rejects a leading 0; PhoneNumber does not). */
const legacyAcceptedPhoneArb = fc
  .tuple(digitsArb, fc.option(noiseCharArb, { nil: null }), fc.boolean())
  .chain(([digits, noiseChar, withPlus]) => {
    if (noiseChar === null) {
      return fc.constant(withPlus ? `+${digits}` : digits)
    }
    return fc.integer({ min: 0, max: digits.length }).map((pos) => {
      const withNoise = digits.slice(0, pos) + noiseChar + digits.slice(pos)
      return withPlus ? `+${withNoise}` : withNoise
    })
  })

function checkNeverUnrecognizedThrow(resolve: (phone: PhoneNumber) => E164Phone, raw: string): void {
  let phone: PhoneNumber
  try {
    phone = PhoneNumber.create(raw)
  } catch {
    // Outside PhoneNumber's own accepted grammar (e.g. digit count fell
    // below 8 after generation) -- out of scope for this property, which
    // is specifically about strings the LEGACY VO already accepts.
    return
  }

  try {
    const result = resolve(phone)
    expect(result).toBeInstanceOf(E164Phone)
  } catch (err) {
    // The ONE acceptable throw shape: PhoneNumber.create's own validation
    // message, recognised by both callers' existing error handling.
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).toMatch(/^Invalid phone number:/)
  }
}

describe('resolveLegacyMemberE164 (G-3): property suite over the legacy VO grammar', () => {
  it('WhatsApp join path (register-member.ts): never an unrecognised throw', () => {
    fc.assert(
      fc.property(legacyAcceptedPhoneArb, (raw) => checkNeverUnrecognizedThrow(resolveWhatsappLegacyE164, raw)),
      { numRuns: 500 }
    )
  })

  it('web QR join path (register-member-web.ts): never an unrecognised throw', () => {
    fc.assert(
      fc.property(legacyAcceptedPhoneArb, (raw) => checkNeverUnrecognizedThrow(resolveWebLegacyE164, raw)),
      { numRuns: 500 }
    )
  })

  it('regression: a letter-noised digit run (the residual gap parseE164Phone alone cannot repair) resolves to the recognised error shape, not an unhandled throw', () => {
    const phone = PhoneNumber.create('98x765432')
    expect(() => resolveWhatsappLegacyE164(phone)).toThrow(/^Invalid phone number:/)
    expect(() => resolveWebLegacyE164(phone)).toThrow(/^Invalid phone number:/)
  })

  it('regression: a leading-zero digit run (E164Phone forbids a leading 0; PhoneNumber does not) resolves to the recognised error shape', () => {
    const phone = PhoneNumber.create('091234567')
    expect(() => resolveWhatsappLegacyE164(phone)).toThrow(/^Invalid phone number:/)
    expect(() => resolveWebLegacyE164(phone)).toThrow(/^Invalid phone number:/)
  })

  it('a dotted legacy format (WI-14\'s own example) still resolves through the seam, not the error path', () => {
    const phone = PhoneNumber.create('+852.9123.4567')
    expect(resolveWhatsappLegacyE164(phone)).toBeInstanceOf(E164Phone)
    expect(resolveWebLegacyE164(phone)).toBeInstanceOf(E164Phone)
  })
})
