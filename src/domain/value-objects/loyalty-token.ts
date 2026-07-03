import crypto from 'crypto'

// Enrollment-issued loyalty QR token (plan §4.3, subtask 13). Every NEW member gets
// one at insert so there is always a scannable persistent QR (LOYALTY:<token>).
// Format mirrors migration 050's existing-member backfill exactly:
// encode(gen_random_bytes(16), 'hex') = 16 random bytes → 32 lowercase hex chars.
// MVP token is plaintext at rest (accepted residual risk R-TOKEN, plan §13).
const LOYALTY_TOKEN_BYTES = 16

export function loyaltyToken(): string {
  return crypto.randomBytes(LOYALTY_TOKEN_BYTES).toString('hex')
}
