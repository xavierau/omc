import { PhoneNumber } from '@/domain/value-objects/phone-number'

/**
 * Build a wa.me deep link for a per-restaurant contact-redirect number.
 *
 * The raw number is validated via `PhoneNumber.create` — unusable input throws
 * and is caught here, returning `null` so callers can omit the Contact option
 * or fall back gracefully. Mirrors `buildDeepLink` in
 * `application/generate-qr.ts` (strip `+`, tap-to-open-new-chat link).
 *
 * Pure: zero infra imports, safe to call from any layer.
 */
export function buildContactUrl(
  redirectNumber: string,
  prefilledText?: string
): string | null {
  let digits: string
  try {
    digits = PhoneNumber.create(redirectNumber).value.replace(/\D/g, '')
  } catch {
    return null
  }

  const base = `https://wa.me/${digits}`
  return prefilledText
    ? `${base}?text=${encodeURIComponent(prefilledText)}`
    : base
}
