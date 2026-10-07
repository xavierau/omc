// INT-001 T-C2 / OQ-7: real E.164 normalization at the partner-API edge.
//
// `PhoneNumber.create` (src/domain/value-objects/phone-number.ts) is not a
// normalizer: it strips only `[\s\-()]`, prefixes `+`, and length-checks the
// *digits* while storing the *uncleaned* string. `9876x5432` -> stored
// `+9876x5432`; `98765432` (a HK number with no country code) becomes
// `+98765432`, a different country entirely. This parser replaces it on the
// partner API path only -- `PhoneNumber` is untouched for existing callers.
//
// "Strips nothing" of its own: any character outside `[+\d\s().-]` (letters,
// zero-width Unicode, control characters) fails a pre-filter BEFORE reaching
// libphonenumber-js, because the library itself silently discards some
// non-digit characters (e.g. zero-width space) as if they were formatting --
// exactly the leniency T-C2 exists to close off.
//
// The tenant's country is not stored yet (OQ-7), so `HK` is the explicit,
// named default region -- never an implicit one.

import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js/max'
import { E164Phone } from '@/domain/value-objects/e164-phone'
import type {
  PhoneNormalizeError,
  PhoneNormalizer,
} from '@/domain/ports/phone-normalizer'

export const DEFAULT_PHONE_REGION: CountryCode = 'HK'

// Only digits, `+`, and common human formatting punctuation. No letters, no
// zero-width or other invisible Unicode, no control characters.
const ALLOWED_INPUT_CHARS = /^[+\d\s().-]+$/

const INVALID: PhoneNormalizeError = { error: 'invalid_e164' }

function tryParse(trimmed: string, region: CountryCode): string | null {
  const direct = parsePhoneNumberFromString(trimmed, region)
  if (direct?.isValid()) return direct.number

  // HK's registered IDD prefix in libphonenumber's metadata does not include
  // plain "00" (it uses 001/002/003/005/006/007/009), but "00" is the
  // ITU-standard international-dial prefix partners commonly send. Retry by
  // treating a leading "00" as "+": `0085298765432` -> `+85298765432`.
  if (trimmed.startsWith('00')) {
    const digitsAfterPrefix = trimmed.slice(2).replace(/\D/g, '')
    const viaIdd = parsePhoneNumberFromString(`+${digitsAfterPrefix}`, region)
    if (viaIdd?.isValid()) return viaIdd.number
  }

  return null
}

/**
 * Parses `raw` into a canonical E.164 number using `region` as the default
 * country when `raw` has no explicit `+` country code. Never throws --
 * returns `{ error: 'invalid_e164' }` for anything malformed, and never
 * echoes `raw` in the result.
 */
export function parseE164Phone(
  raw: string,
  region: CountryCode = DEFAULT_PHONE_REGION
): E164Phone | PhoneNormalizeError {
  if (typeof raw !== 'string') return INVALID

  const trimmed = raw.trim()
  if (trimmed.length === 0 || !ALLOWED_INPUT_CHARS.test(trimmed)) return INVALID

  const e164 = tryParse(trimmed, region)
  if (!e164) return INVALID

  try {
    return E164Phone.of(e164)
  } catch {
    return INVALID
  }
}

export const e164PhoneNormalizer: PhoneNormalizer = {
  parse: (raw, region) =>
    parseE164Phone(raw, (region as CountryCode) || DEFAULT_PHONE_REGION),
}
