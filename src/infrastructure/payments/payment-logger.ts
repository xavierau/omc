/**
 * BOOK-014 (threat R63, R64): the payment server log. One JSON line per
 * entry; any string that looks like a provider secret (sk_/rk_ API keys,
 * whsec_ webhook secrets, at any depth of the data) is replaced before it is
 * written. Provider error details go here, with the deposit id, and nowhere
 * a diner or agent can see.
 */
import type { PaymentLog } from '@/domain/ports/booking-deposit'

const SECRET = /\b(?:(?:sk|rk)_(?:test|live)_[A-Za-z0-9]+|whsec_[A-Za-z0-9+/=_-]+)/g
export const REDACTED = '[redacted]'

export function redactSecrets<T>(value: T, depth = 0): T {
  if (typeof value === 'string') return value.replace(SECRET, REDACTED) as T
  if (depth > 6 || value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map((v) => redactSecrets(v, depth + 1)) as T
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, redactSecrets(v, depth + 1)])) as T
}

type Sink = Pick<Console, 'info' | 'warn' | 'error'>

export function createPaymentLogger(sink: Sink = console): PaymentLog {
  return (level, event, data) => {
    try {
      sink[level](`[Payments] ${JSON.stringify(redactSecrets({ event, ...(data ?? {}) }))}`)
    } catch {
      // Logging never breaks a payment path.
    }
  }
}

export const paymentLog: PaymentLog = createPaymentLogger()
