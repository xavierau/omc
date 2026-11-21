/**
 * BOOK-001 R14: a URL safe to show a diner. Moved out of booking-config.ts
 * (BOOK-009) so the booking-hours validator can use it without an import
 * cycle; booking-config.ts re-exports both names.
 */
export const EXTERNAL_URL_MAX = 2048

/** `https:` with a host, no credentials, no whitespace, ≤ 2,048 chars (R14). */
export function isSafeHttpsUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > EXTERNAL_URL_MAX || /\s/.test(value)) return false
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname.length > 0 && !url.username && !url.password
  } catch {
    return false
  }
}
