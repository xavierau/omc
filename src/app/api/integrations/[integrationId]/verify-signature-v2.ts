// INT-001 WI-2: auth v2 entry point for the partner member-creation API.
// Covers steps 1-2 of the plan's §"Inbound auth v2" pipeline (strict header
// parse, integration lookup, constant-time dummy-secret check for an
// unknown id) and delegates steps 3-8 to `guardInboundRequest`.
//
// The legacy `verify-signature.ts` (HMAC over rawBody alone, no timestamp,
// no nonce, no domain separation) is untouched -- this is a NEW, parallel
// module for the NEW scheme, same pattern as the legacy file: it throws a
// typed error rather than building a NextResponse (that stays with the
// route, WI-3).

import { findPosIntegrationById } from '@/infrastructure/supabase/repositories/pos-integration-repository'
import type { PosIntegration } from '@/domain/entities/pos-integration'
import type { RateLimiterPort } from '@/domain/ports/rate-limiter'
import type { Clock } from '@/domain/ports/clock'
import {
  buildInboundBase,
  parseInboundSignatureHeader,
  verifyHmacSha256Hex,
  type InboundSignatureKind,
} from '@/domain/services/webhook-signature'
import {
  chargeAuthFailureAndDecide,
  guardInboundRequest,
  type GuardFailure,
} from '@/application/integration-inbound-guard'

const TIMESTAMP_FORMAT = /^\d+$/
const NONCE_FORMAT = /^[A-Za-z0-9_-]{16,64}$/

// Process-constant dummy secret so an unknown integration's signature check
// takes the same time as a real one -- an attacker must not be able to
// distinguish "no such integration" from "wrong signature" by response
// timing (step 2 of §Inbound auth v2).
const DUMMY_SECRET = 'int001-v2-dummy-secret-unknown-integration-constant-time'

export class IntegrationAuthErrorV2 extends Error {
  constructor(
    message: string,
    public readonly statusCode: 401 | 403 | 429 | 503,
    public readonly errorCode: GuardFailure['error'],
    public readonly retryAfterSec?: number,
    public readonly remaining?: number
  ) {
    super(message)
    this.name = 'IntegrationAuthErrorV2'
  }
}

export interface InboundHeaders {
  timestamp: string | null
  nonce: string | null
  signature: string | null
}

export interface AuthenticateV2Input {
  integrationId: string
  kind: InboundSignatureKind
  headers: InboundHeaders
  /** sha256hex(rawBody) for a POST; the jobId itself for a signed GET poll
   * (both match `digest` in the plan's buildInboundBase formulas). */
  digest: string
  clientIp: string
  rateLimiter: RateLimiterPort
  clock: Clock
  inboundDisabled: boolean
  limits?: { ratePerMin: number; burst: number }
}

export interface AuthenticatedIntegrationV2 {
  integration: PosIntegration
  t: string
  nonce: string
  replayed: boolean
}

interface ParsedHeaders {
  t: string
  nonce: string
  signatureHex: string
}

function parseHeaders(headers: InboundHeaders): ParsedHeaders | null {
  const { timestamp, nonce, signature } = headers
  if (!timestamp || !TIMESTAMP_FORMAT.test(timestamp)) return null
  if (!nonce || !NONCE_FORMAT.test(nonce)) return null
  if (!signature) return null
  const parsedSignature = parseInboundSignatureHeader(signature)
  if ('error' in parsedSignature) return null
  return { t: timestamp, nonce, signatureHex: parsedSignature.v2 }
}

function toError(decision: GuardFailure): IntegrationAuthErrorV2 {
  return new IntegrationAuthErrorV2(
    decision.error,
    decision.status,
    decision.error,
    'retryAfterSec' in decision ? decision.retryAfterSec : undefined,
    'remaining' in decision ? decision.remaining : undefined
  )
}

/**
 * Authenticates a v2-signed inbound request. Resolves with the integration
 * (plus whether this (integrationId, nonce) pair was already seen within
 * the replay window) on success; throws `IntegrationAuthErrorV2` on any
 * failure -- malformed headers, unknown integration, expired timestamp,
 * bad signature, inactive integration, the inbound kill switch, or the
 * partner's rate limit.
 */
export async function authenticateIntegrationV2(
  input: AuthenticateV2Input
): Promise<AuthenticatedIntegrationV2> {
  const parsed = parseHeaders(input.headers)
  if (!parsed) {
    // Malformed headers never reach the database (step 1 fails before step 2).
    throw toError(await chargeAuthFailureAndDecide(input.rateLimiter, input.integrationId, input.clientIp))
  }

  const integration = await findPosIntegrationById(input.integrationId)
  const secret = integration?.webhookSecret ?? DUMMY_SECRET
  const base = buildInboundBase(input.kind, input.integrationId, parsed.t, parsed.nonce, input.digest)
  // Always run the comparison, even for an integration we already know is
  // unknown -- see DUMMY_SECRET above.
  const signatureValid = verifyHmacSha256Hex(secret, base, parsed.signatureHex)

  if (!integration) {
    throw toError(await chargeAuthFailureAndDecide(input.rateLimiter, input.integrationId, input.clientIp))
  }

  const decision = await guardInboundRequest({
    integration: { id: integration.id, status: integration.status },
    clientIp: input.clientIp,
    t: parsed.t,
    nonce: parsed.nonce,
    signatureValid,
    rateLimiter: input.rateLimiter,
    clock: input.clock,
    inboundDisabled: input.inboundDisabled,
    limits: input.limits,
  })

  if (!decision.ok) {
    throw toError(decision)
  }

  return { integration, t: parsed.t, nonce: parsed.nonce, replayed: decision.replayed }
}
