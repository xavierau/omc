/**
 * BOOK-003: the random values of agent booking (R31, R36, R43). Tests pass
 * deterministic stand-ins through the same interface.
 */
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'

export interface AgentBookingSecrets {
  /** Uniform integer in [0, n) from a CSPRNG. */
  randomIndex(n: number): number
  /** 256-bit status token, base64url (43 chars). */
  statusToken(): string
  /** 192-bit agent booking id, base64url (32 chars). */
  publicId(): string
}

export const agentBookingSecrets: AgentBookingSecrets = {
  randomIndex: (n) => randomInt(n),
  statusToken: () => randomBytes(32).toString('base64url'),
  publicId: () => randomBytes(24).toString('base64url'),
}

/** Only this is stored; the token itself never is (R36). */
export function hashStatusToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function statusTokenMatches(token: string, storedHash: string | null): boolean {
  if (!storedHash) return false
  const a = Buffer.from(hashStatusToken(token), 'hex')
  const b = Buffer.from(storedHash, 'hex')
  return a.length === b.length && timingSafeEqual(a, b)
}
