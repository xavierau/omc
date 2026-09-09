// INT-001 WI-3: frozen acceptance suite for POST
// /api/integrations/{integrationId}/members (spec US-1, kanban INT-001
// CONSTRAINT). Auth internals are covered by verify-signature-v2.test.ts /
// integration-inbound-guard.test.ts -- these tests mock
// `authenticateIntegrationV2` and focus on THIS route's own wiring:
// validation, the "no members write" boundary, 202 shape, and error-status
// mapping.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// Mock only `authenticateIntegrationV2` -- keep the REAL `IntegrationAuthErrorV2`
// class (via importOriginal) so `authErrorResponse`'s `instanceof` check
// (in a DIFFERENT module that also imports this same file) still recognises
// errors thrown from this test as the real class, not an auto-mocked stand-in.
vi.mock('../../verify-signature-v2', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../verify-signature-v2')>()
  return { ...actual, authenticateIntegrationV2: vi.fn() }
})
vi.mock('@/infrastructure/supabase/repositories/integration-settings-repository')
vi.mock('@/infrastructure/queue/integration-inbound-queue')
vi.mock('@/application/create-or-get-member')
vi.mock('@/infrastructure/supabase/repositories/integration-member-job-repository')

import { authenticateIntegrationV2, IntegrationAuthErrorV2 } from '../../verify-signature-v2'
import { findIntegrationSettingsById } from '@/infrastructure/supabase/repositories/integration-settings-repository'
import { addMemberCreateJob, getGlobalCeilingGuard, getInboundRateLimiter } from '@/infrastructure/queue/integration-inbound-queue'
import { createOrGetMember } from '@/application/create-or-get-member'
import { insertMemberJob } from '@/infrastructure/supabase/repositories/integration-member-job-repository'
import { POST } from '../route'

const INTEGRATION_ID = 'int-1'
const RESTAURANT_ID = 'rest-1'

function req(body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(`http://localhost/api/integrations/${INTEGRATION_ID}/members`, {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: {
      'content-type': 'application/json',
      'x-omc-timestamp': '1700000000',
      'x-omc-nonce': 'a'.repeat(16),
      'x-omc-signature': 'v2=' + 'b'.repeat(64),
      ...headers,
    },
  })
}

function params() {
  return { params: Promise.resolve({ integrationId: INTEGRATION_ID }) }
}

function stubAuthOk() {
  vi.mocked(authenticateIntegrationV2).mockResolvedValue({
    integration: { id: INTEGRATION_ID, restaurantId: RESTAURANT_ID, status: 'active' } as never,
    t: '1700000000',
    nonce: 'a'.repeat(16),
    replayed: false,
  })
}

describe('POST /api/integrations/{integrationId}/members (INT-001 WI-3, US-1)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.INT_JOBID_KEY = 'test-job-id-key'
    vi.mocked(findIntegrationSettingsById).mockResolvedValue(null)
    vi.mocked(getInboundRateLimiter).mockReturnValue({
      takeToken: vi.fn(),
      incrWindow: vi.fn().mockResolvedValue({ allowed: true, count: 1 }),
      incr: vi.fn().mockResolvedValue(1),
      decr: vi.fn().mockResolvedValue(0),
      get: vi.fn().mockResolvedValue(0),
    } as never)
    vi.mocked(getGlobalCeilingGuard).mockReturnValue({
      check: vi.fn().mockResolvedValue({ exceeded: false, depth: 0 }),
    } as never)
    vi.mocked(addMemberCreateJob).mockResolvedValue(undefined)
    vi.mocked(insertMemberJob).mockResolvedValue({
      inserted: true,
      row: {
        job_id: 'mj_x',
        integration_id: INTEGRATION_ID,
        restaurant_id: RESTAURANT_ID,
        status: 'queued',
        outcome: null,
        member_id: null,
        error_code: null,
        error_message: null,
        attempts: 0,
        asserted_level: 'all',
        send_welcome: true,
        consent_actions: null,
        welcome_outcome: null,
        welcome_detail: null,
        metadata: null,
        external_ref: null,
        phone_last4: '5432',
        submitted_at: '2026-09-10T00:00:00.000Z',
        started_at: null,
        completed_at: null,
        result_expires_at: null,
      },
    })
  })

  it('valid signed request -> 202 { job_id, status, poll_url }, and NEVER writes a members row (spy on the seam)', async () => {
    stubAuthOk()

    const res = await POST(req({ phone: '+85298765432', consent_level: 'all' }), params())
    const json = await res.json()

    expect(res.status).toBe(202)
    expect(json).toEqual({
      job_id: expect.stringMatching(/^mj_/),
      status: 'queued',
      poll_url: `/api/integrations/${INTEGRATION_ID}/members/jobs/${json.job_id}`,
    })
    expect(createOrGetMember).not.toHaveBeenCalled()
  })

  it('sets no Access-Control-Allow-* headers (server-to-server only, §5.0)', async () => {
    stubAuthOk()

    const res = await POST(req({ phone: '+85298765432', consent_level: 'all' }), params())

    expect(res.headers.get('access-control-allow-origin')).toBeNull()
  })

  it('same body submitted twice -> the same job_id (T-H3b), the second submission never re-inserts', async () => {
    stubAuthOk()

    const first = await POST(req({ phone: '+85298765432', consent_level: 'all' }), params())
    const firstJson = await first.json()

    // This route test's rate-limiter mock always reports the Redis
    // idempotency check as "not seen" (see beforeEach), so the second
    // request also takes the fresh-reservation path and hits Postgres's
    // job_id PK conflict -- exactly the "concurrent duplicate" scenario
    // `enqueue-member-create.test.ts` covers directly; this test only
    // proves the ROUTE surfaces that outcome correctly (same job_id, no
    // second q.add).
    vi.mocked(insertMemberJob).mockResolvedValueOnce({
      inserted: false,
      row: {
        job_id: firstJson.job_id,
        integration_id: INTEGRATION_ID,
        restaurant_id: RESTAURANT_ID,
        status: 'processing',
        outcome: null,
        member_id: null,
        error_code: null,
        error_message: null,
        attempts: 1,
        asserted_level: 'all',
        send_welcome: true,
        consent_actions: null,
        welcome_outcome: null,
        welcome_detail: null,
        metadata: null,
        external_ref: null,
        phone_last4: '5432',
        submitted_at: '2026-09-10T00:00:00.000Z',
        started_at: '2026-09-10T00:00:01.000Z',
        completed_at: null,
        result_expires_at: null,
      },
    })

    const second = await POST(req({ phone: '+85298765432', consent_level: 'all' }), params())
    const secondJson = await second.json()

    expect(second.status).toBe(202)
    expect(secondJson.job_id).toBe(firstJson.job_id)
    expect(addMemberCreateJob).toHaveBeenCalledTimes(1)
  })

  it('missing consent_level -> 422 { error: "validation", fields: [...] }, no auth-bypassing side effects', async () => {
    stubAuthOk()

    const res = await POST(req({ phone: '+85298765432' }), params())
    const json = await res.json()

    expect(res.status).toBe(422)
    expect(json).toEqual({ error: 'validation', fields: [{ field: 'consent_level', code: 'required' }] })
    expect(insertMemberJob).not.toHaveBeenCalled()
  })

  it('invalid phone -> 422, the raw value never appears in the response body', async () => {
    stubAuthOk()

    const res = await POST(req({ phone: '9876x5432', consent_level: 'all' }), params())
    const text = await res.text()

    expect(res.status).toBe(422)
    expect(text).not.toContain('9876x5432')
  })

  it('body over 16KB -> 413 payload_too_large, before authentication is even attempted', async () => {
    const res = await POST(req('x'.repeat(20_000)), params())

    expect(res.status).toBe(413)
    const json = await res.json()
    expect(json).toEqual({ error: 'payload_too_large' })
    expect(authenticateIntegrationV2).not.toHaveBeenCalled()
  })

  it('non-JSON content-type -> 415 unsupported_media_type', async () => {
    const res = await POST(req({ phone: '+85298765432', consent_level: 'all' }, { 'content-type': 'text/plain' }), params())

    expect(res.status).toBe(415)
  })

  it('authenticateIntegrationV2 throws unauthorized -> byte-identical 401 body, no enqueue attempted', async () => {
    vi.mocked(authenticateIntegrationV2).mockRejectedValue(
      new IntegrationAuthErrorV2('bad signature', 401, 'unauthorized')
    )

    const res = await POST(req({ phone: '+85298765432', consent_level: 'all' }), params())
    const json = await res.json()

    expect(res.status).toBe(401)
    expect(json).toEqual({ error: 'unauthorized' })
    expect(insertMemberJob).not.toHaveBeenCalled()
  })

  it('rate_limited -> 429 with Retry-After and X-RateLimit-Remaining from the thrown error', async () => {
    vi.mocked(authenticateIntegrationV2).mockRejectedValue(
      new IntegrationAuthErrorV2('rate limited', 429, 'rate_limited', 12, 0)
    )

    const res = await POST(req({ phone: '+85298765432', consent_level: 'all' }), params())

    expect(res.status).toBe(429)
    expect(res.headers.get('retry-after')).toBe('12')
    expect(res.headers.get('x-ratelimit-remaining')).toBe('0')
  })

  it('queue_depth_exceeded from enqueueMemberCreate -> 503 with Retry-After', async () => {
    stubAuthOk()
    vi.mocked(getInboundRateLimiter).mockReturnValue({
      takeToken: vi.fn(),
      incrWindow: vi.fn().mockResolvedValue({ allowed: true, count: 1 }),
      incr: vi.fn().mockResolvedValue(1000), // over any reasonable cap
      decr: vi.fn().mockResolvedValue(0),
      get: vi.fn().mockResolvedValue(0),
    } as never)

    const res = await POST(req({ phone: '+85298765432', consent_level: 'all' }), params())
    const json = await res.json()

    expect(res.status).toBe(503)
    expect(json).toEqual({ error: 'queue_depth_exceeded' })
    expect(res.headers.get('retry-after')).toBe('5')
    expect(insertMemberJob).not.toHaveBeenCalled()
  })
})
