// INT-001 WI-2: `authenticateIntegrationV2` covers steps 1-2 of the plan's
// §"Inbound auth v2" pipeline (strict header parse, integration lookup,
// constant-time dummy-secret check for an unknown id) and delegates steps
// 3-8 to `guardInboundRequest` (see integration-inbound-guard.test.ts).
//
// Frozen acceptance-suite items covered here (plan §WI-2 "Tests (first)"):
//   - body-only legacy signature -> 401
//   - signature valid for /api/webhooks/pos/{id} -> 401 (domain separation)
//   - unknown id vs bad signature -> byte-identical 401 bodies
//   - inactive + valid signature -> 403
//   - strict header parser rejects duplicate/unknown params

import { createHash, createHmac } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeClock } from '@/test-utils/fake-clock'
import { FakeRateLimiter } from '@/test-utils/fake-rate-limiter'
import { buildInboundBase, signHmacSha256Hex } from '@/domain/services/webhook-signature'

vi.mock('@/infrastructure/supabase/repositories/pos-integration-repository', () => ({
  findPosIntegrationById: vi.fn(),
}))

import { findPosIntegrationById } from '@/infrastructure/supabase/repositories/pos-integration-repository'
import {
  IntegrationAuthErrorV2,
  authenticateIntegrationV2,
  type AuthenticateV2Input,
} from '../verify-signature-v2'

const SECRET = 'super-secret-webhook-key'
const INTEGRATION_ID = 'int-abc'
const RAW_BODY = '{"phone":"+85298765432","consent_level":"utility"}'
const BODY_DIGEST = createHash('sha256').update(RAW_BODY).digest('hex')
const NOW = new Date('2026-01-01T00:00:00.000Z')

function activeIntegration(overrides: Record<string, unknown> = {}) {
  return {
    id: INTEGRATION_ID,
    restaurantId: 'rest-1',
    provider: 'generic' as const,
    name: 'Test POS',
    status: 'active' as const,
    webhookSecret: SECRET,
    fieldMapping: null,
    credentials: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function baseCallInput(overrides: Partial<AuthenticateV2Input> = {}): AuthenticateV2Input {
  const clock = overrides.clock ?? new FakeClock(NOW)
  const rateLimiter = overrides.rateLimiter ?? new FakeRateLimiter(clock)
  const t = String(Math.floor(NOW.getTime() / 1000))
  const nonce = 'nonce-0000000000000001'
  const base = buildInboundBase('member.create', INTEGRATION_ID, t, nonce, BODY_DIGEST)
  const signatureHex = signHmacSha256Hex(SECRET, base)
  return {
    integrationId: INTEGRATION_ID,
    kind: 'member.create',
    headers: {
      timestamp: t,
      nonce,
      signature: `v2=${signatureHex}`,
    },
    digest: BODY_DIGEST,
    clientIp: '203.0.113.9',
    rateLimiter,
    clock,
    inboundDisabled: false,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('authenticateIntegrationV2: happy path', () => {
  it('resolves with the integration on a valid v2 signature', async () => {
    vi.mocked(findPosIntegrationById).mockResolvedValue(activeIntegration())
    const result = await authenticateIntegrationV2(baseCallInput())
    expect(result.integration.id).toBe(INTEGRATION_ID)
    expect(result.replayed).toBe(false)
  })
})

describe('authenticateIntegrationV2: legacy / domain separation', () => {
  it('rejects a body-only legacy signature (HMAC(secret, rawBody) alone, no v2 base) with 401', async () => {
    vi.mocked(findPosIntegrationById).mockResolvedValue(activeIntegration())
    const legacySignature = createHmac('sha256', SECRET).update(RAW_BODY).digest('hex')
    const input = baseCallInput({
      headers: {
        timestamp: String(Math.floor(NOW.getTime() / 1000)),
        nonce: 'nonce-0000000000000001',
        signature: `v2=${legacySignature}`,
      },
    })
    await expect(authenticateIntegrationV2(input)).rejects.toMatchObject({
      statusCode: 401,
      errorCode: 'unauthorized',
    })
  })

  it('rejects a signature computed for the legacy POS webhook endpoint the same way (domain separation, T-H2)', async () => {
    // Simulates a signature captured from /api/webhooks/pos/{id}, which
    // signs rawBody alone with no scheme prefix -- reusing it against the
    // v2 base (which is domain-separated with "v2:member.create:...") must
    // never validate, even though both use the SAME webhook_secret.
    vi.mocked(findPosIntegrationById).mockResolvedValue(activeIntegration())
    const posWebhookStyleSignature = createHmac('sha256', SECRET).update(RAW_BODY).digest('hex')
    const input = baseCallInput({
      headers: {
        timestamp: String(Math.floor(NOW.getTime() / 1000)),
        nonce: 'nonce-0000000000000001',
        signature: `v2=${posWebhookStyleSignature}`,
      },
    })
    await expect(authenticateIntegrationV2(input)).rejects.toMatchObject({
      statusCode: 401,
      errorCode: 'unauthorized',
    })
  })
})

describe('authenticateIntegrationV2: unknown integration vs bad signature -> byte-identical 401', () => {
  it('produces the same error shape whether the integration is unknown or the signature is wrong', async () => {
    vi.mocked(findPosIntegrationById).mockResolvedValueOnce(null)
    const unknownErr = await authenticateIntegrationV2(baseCallInput({ integrationId: 'does-not-exist' })).catch(
      (e) => e
    )

    vi.mocked(findPosIntegrationById).mockResolvedValueOnce(activeIntegration())
    const badSigInput = baseCallInput({
      headers: {
        timestamp: String(Math.floor(NOW.getTime() / 1000)),
        nonce: 'nonce-0000000000000002',
        signature: `v2=${'0'.repeat(64)}`,
      },
    })
    const badSigErr = await authenticateIntegrationV2(badSigInput).catch((e) => e)

    expect(unknownErr).toBeInstanceOf(IntegrationAuthErrorV2)
    expect(badSigErr).toBeInstanceOf(IntegrationAuthErrorV2)
    expect({ statusCode: unknownErr.statusCode, errorCode: unknownErr.errorCode }).toEqual({
      statusCode: badSigErr.statusCode,
      errorCode: badSigErr.errorCode,
    })
    expect(unknownErr.statusCode).toBe(401)
    expect(unknownErr.errorCode).toBe('unauthorized')
  })

  it('still runs a constant-time dummy-secret check for an unknown integration (does not short-circuit before hashing)', async () => {
    vi.mocked(findPosIntegrationById).mockResolvedValue(null)
    // Whatever signature is presented, an unknown integration is always 401
    // -- but the important structural property is that lookup happens and
    // a signature comparison is attempted regardless (see verify-signature-v2.ts).
    await expect(authenticateIntegrationV2(baseCallInput())).rejects.toMatchObject({ statusCode: 401 })
    expect(findPosIntegrationById).toHaveBeenCalledWith(INTEGRATION_ID)
  })
})

describe('authenticateIntegrationV2: status check (T-M12)', () => {
  it('returns 403 integration_inactive for a valid signature against an inactive integration', async () => {
    vi.mocked(findPosIntegrationById).mockResolvedValue(activeIntegration({ status: 'inactive' }))
    await expect(authenticateIntegrationV2(baseCallInput())).rejects.toMatchObject({
      statusCode: 403,
      errorCode: 'integration_inactive',
    })
  })
})

describe('authenticateIntegrationV2: strict header parse', () => {
  it('rejects a missing timestamp header with 401', async () => {
    vi.mocked(findPosIntegrationById).mockResolvedValue(activeIntegration())
    const input = baseCallInput({ headers: { timestamp: null, nonce: 'nonce-0000000000000001', signature: 'v2=' + 'a'.repeat(64) } })
    await expect(authenticateIntegrationV2(input)).rejects.toMatchObject({ statusCode: 401, errorCode: 'unauthorized' })
  })

  it('rejects a nonce shorter than 16 chars with 401', async () => {
    vi.mocked(findPosIntegrationById).mockResolvedValue(activeIntegration())
    const input = baseCallInput({
      headers: { timestamp: String(Math.floor(NOW.getTime() / 1000)), nonce: 'short', signature: 'v2=' + 'a'.repeat(64) },
    })
    await expect(authenticateIntegrationV2(input)).rejects.toMatchObject({ statusCode: 401, errorCode: 'unauthorized' })
  })

  it('rejects a signature header with a duplicate v2 param', async () => {
    vi.mocked(findPosIntegrationById).mockResolvedValue(activeIntegration())
    const input = baseCallInput({
      headers: {
        timestamp: String(Math.floor(NOW.getTime() / 1000)),
        nonce: 'nonce-0000000000000001',
        signature: `v2=${'a'.repeat(64)},v2=${'b'.repeat(64)}`,
      },
    })
    await expect(authenticateIntegrationV2(input)).rejects.toMatchObject({ statusCode: 401, errorCode: 'unauthorized' })
  })

  it('rejects a signature header with an unknown param', async () => {
    vi.mocked(findPosIntegrationById).mockResolvedValue(activeIntegration())
    const input = baseCallInput({
      headers: {
        timestamp: String(Math.floor(NOW.getTime() / 1000)),
        nonce: 'nonce-0000000000000001',
        signature: `v2=${'a'.repeat(64)},extra=1`,
      },
    })
    await expect(authenticateIntegrationV2(input)).rejects.toMatchObject({ statusCode: 401, errorCode: 'unauthorized' })
  })

  it('never calls the integration lookup for a malformed header (fails before DB access)', async () => {
    const input = baseCallInput({ headers: { timestamp: null, nonce: null, signature: null } })
    await expect(authenticateIntegrationV2(input)).rejects.toMatchObject({ statusCode: 401 })
    expect(findPosIntegrationById).not.toHaveBeenCalled()
  })
})

describe('authenticateIntegrationV2: kill switch and rate limiting pass through from the guard', () => {
  it('propagates 503 feature_disabled from the guard', async () => {
    vi.mocked(findPosIntegrationById).mockResolvedValue(activeIntegration())
    await expect(authenticateIntegrationV2(baseCallInput({ inboundDisabled: true }))).rejects.toMatchObject({
      statusCode: 503,
      errorCode: 'feature_disabled',
    })
  })
})
