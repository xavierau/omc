// INT-001: HMAC-SHA256 signing/parsing shared by the inbound auth v2
// pipeline (WI-2) and the outbound delivery signer (WI-6). Pure -- no
// network, no clock (the caller supplies `t`).

import { createHmac, timingSafeEqual } from 'node:crypto'

export type InboundSignatureKind = 'member.create' | 'member.job'

const KIND_LABEL: Record<InboundSignatureKind, string> = {
  'member.create': 'v2:member.create:',
  'member.job': 'v2:member.job:',
}

/**
 * `POST base = "v2:member.create:" + integrationId + ":" + t + ":" + nonce + ":" + sha256hex(rawBody)`
 * `GET  base = "v2:member.job:"    + integrationId + ":" + t + ":" + nonce + ":" + jobId`
 * `digest` is either `sha256hex(rawBody)` (POST) or the `jobId` (GET) --
 * the caller picks which one to pass based on `kind`.
 */
export function buildInboundBase(
  kind: InboundSignatureKind,
  integrationId: string,
  t: string,
  nonce: string,
  digest: string
): string {
  return `${KIND_LABEL[kind]}${integrationId}:${t}:${nonce}:${digest}`
}

export function signHmacSha256Hex(secret: string, base: string): string {
  return createHmac('sha256', secret).update(base).digest('hex')
}

/** Constant-time comparison of two hex-encoded HMAC digests. Mismatched
 * lengths compare against a dummy buffer of the expected length so timing
 * never reveals the length mismatch either. */
export function verifyHmacSha256Hex(
  secret: string,
  base: string,
  candidateHex: string
): boolean {
  const expected = Buffer.from(signHmacSha256Hex(secret, base), 'hex')
  const candidate = /^[0-9a-f]+$/i.test(candidateHex) && candidateHex.length % 2 === 0
    ? Buffer.from(candidateHex, 'hex')
    : Buffer.alloc(0)
  if (candidate.length !== expected.length) {
    // Still do a constant-time compare against a same-length dummy so the
    // early-return above doesn't leak length via a faster path than the
    // matching-length case.
    timingSafeEqual(expected, expected)
    return false
  }
  return timingSafeEqual(expected, candidate)
}

/**
 * `X-OMC-Signature: t=<unix>,v1=<hex HMAC-SHA256(secret, t + "." + body)>`
 * (outbound, WI-6). Strict: exactly the two named params, no duplicates, no
 * unknown params, in either order.
 */
export function parseOutboundSignatureHeader(
  header: string
): { t: string; v1: string } | { error: 'malformed' } {
  const parts = header.split(',')
  if (parts.length !== 2) return { error: 'malformed' }

  const params = new Map<string, string>()
  for (const part of parts) {
    const eq = part.indexOf('=')
    if (eq === -1) return { error: 'malformed' }
    const key = part.slice(0, eq).trim()
    const value = part.slice(eq + 1).trim()
    if (params.has(key)) return { error: 'malformed' }
    params.set(key, value)
  }

  const t = params.get('t')
  const v1 = params.get('v1')
  if (!t || !v1 || params.size !== 2) return { error: 'malformed' }
  if (!/^\d+$/.test(t)) return { error: 'malformed' }
  if (!/^[0-9a-f]{64}$/i.test(v1)) return { error: 'malformed' }
  return { t, v1 }
}

/**
 * `X-OMC-Signature: v2=<64 hex>` (inbound, WI-2). Strict: exactly one
 * param, no duplicates, no unknown params.
 */
export function parseInboundSignatureHeader(
  header: string
): { v2: string } | { error: 'malformed' } {
  const parts = header.split(',')
  if (parts.length !== 1) return { error: 'malformed' }

  const eq = parts[0].indexOf('=')
  if (eq === -1) return { error: 'malformed' }
  const key = parts[0].slice(0, eq).trim()
  const value = parts[0].slice(eq + 1).trim()
  if (key !== 'v2') return { error: 'malformed' }
  if (!/^[0-9a-f]{64}$/i.test(value)) return { error: 'malformed' }
  return { v2: value }
}
