import type { E164Phone } from '../value-objects/e164-phone'

export type PhoneNormalizeError = { error: 'invalid_e164' }

/**
 * Real E.164 parsing/validation (T-C2). `PhoneNumber.create` (the legacy VO)
 * is not a normalizer -- it stores whatever was typed. This port is the only
 * value that reaches idempotency, member lookup, consent and the outbound
 * payload on the partner API path. Rejects, never coerces or echoes the raw
 * input back to the caller.
 */
export interface PhoneNormalizer {
  parse(raw: string, region: string): E164Phone | PhoneNormalizeError
}

export function isPhoneNormalizeError(
  value: E164Phone | PhoneNormalizeError
): value is PhoneNormalizeError {
  return typeof value === 'object' && value !== null && 'error' in value
}
