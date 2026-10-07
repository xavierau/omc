import { randomUUID } from 'node:crypto'
import type { Clock, NonceSource } from '@/domain/ports/clock'

export const systemClock: Clock = {
  now: () => new Date(),
}

// 32 hex chars -- well within the X-OMC-Nonce contract (16-64 chars,
// [A-Za-z0-9_-]) that WI-2's inbound auth v2 header parser enforces.
export const systemNonceSource: NonceSource = {
  next: () => randomUUID().replace(/-/g, ''),
}
