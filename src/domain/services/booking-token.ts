/**
 * BOOK-001: personal booking link rules (R1).
 *
 * A token is 256 bits of CSPRNG in base64url (43 chars). Anything that does
 * not look like one is `unknown` without a database read.
 */
export type BookingTokenState = 'valid' | 'expired' | 'consumed' | 'unknown'
export type BookingLinkSource = 'chat' | 'campaign'

export const BOOKING_TOKEN_BYTES = 32
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43,128}$/

export function isWellFormedBookingToken(value: unknown): value is string {
  return typeof value === 'string' && TOKEN_SHAPE.test(value)
}

/** `ttlHours` null = no expiry (owner 2026-11-12). */
export function bookingTokenExpiry(now: Date, ttlHours: number | null): string | null {
  if (ttlHours === null) return null
  return new Date(now.getTime() + ttlHours * 3_600_000).toISOString()
}

/**
 * Consumed is checked before expiry: "this link was already used" is more
 * useful than "expired" to someone who already sent a request.
 */
export function bookingTokenState(
  row: { expiresAt: string | null; consumedAt: string | null } | null,
  now: Date
): BookingTokenState {
  if (!row) return 'unknown'
  if (row.consumedAt) return 'consumed'
  if (row.expiresAt !== null && Date.parse(row.expiresAt) <= now.getTime()) return 'expired'
  return 'valid'
}

/** F5 (review #3): the least time a reused chat link must have left. */
export const CHAT_LINK_REUSE_MIN_MS = 3_600_000

/**
 * A repeat BOOK reuses the diner's live chat link only when it never expires
 * or has at least an hour left; otherwise a fresh link is minted, so the
 * diner is never sent one that dies before they can use it.
 */
export function isReusableChatLink(expiresAt: string | null, now: Date): boolean {
  if (expiresAt === null) return true
  const left = Date.parse(expiresAt) - now.getTime()
  return left >= CHAT_LINK_REUSE_MIN_MS
}
