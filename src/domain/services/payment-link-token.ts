/**
 * BOOK-014 (threat R62): the /p/<token> payment link. 32 random bytes,
 * base64url (43 characters), as `booking_tokens`; only its SHA-256 is stored,
 * so the database alone cannot rebuild a link. One token, one deposit; it is
 * valid while the hold is.
 */
import { createHash, randomBytes } from 'node:crypto'

export const PAYMENT_LINK_TOKEN_BYTES = 32
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43,128}$/

export function mintPaymentLinkToken(): { token: string; hash: string } {
  const token = randomBytes(PAYMENT_LINK_TOKEN_BYTES).toString('base64url')
  return { token, hash: hashPaymentLinkToken(token) }
}

export function hashPaymentLinkToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

/** A short or odd token is never looked up (R62). */
export function isPaymentLinkTokenShape(value: string): boolean {
  return TOKEN_SHAPE.test(value)
}

export function paymentLinkPath(token: string): string {
  return `/p/${token}`
}
