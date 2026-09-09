// INT-001 WI-3: frozen acceptance suite for GET
// /api/integrations/{integrationId}/members/jobs/{jobId} (spec US-2, T-H4).

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('../../../../verify-signature-v2', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../verify-signature-v2')>()
  return { ...actual, authenticateIntegrationV2: vi.fn() }
})
vi.mock('@/infrastructure/supabase/repositories/integration-settings-repository')
vi.mock('@/infrastructure/queue/integration-inbound-queue')
vi.mock('@/application/get-member-job')

import { authenticateIntegrationV2, IntegrationAuthErrorV2 } from '../../../../verify-signature-v2'
import { findIntegrationSettingsById } from '@/infrastructure/supabase/repositories/integration-settings-repository'
import { getInboundRateLimiter } from '@/infrastructure/queue/integration-inbound-queue'
import { getMemberJob } from '@/application/get-member-job'
import { GET } from '../route'

const INTEGRATION_ID = 'int-1'
const JOB_ID = 'mj_abc'

function req(): NextRequest {
  return new NextRequest(`http://localhost/api/integrations/${INTEGRATION_ID}/members/jobs/${JOB_ID}`, {
    method: 'GET',
    headers: {
      'x-omc-timestamp': '1700000000',
      'x-omc-nonce': 'a'.repeat(16),
      'x-omc-signature': 'v2=' + 'b'.repeat(64),
    },
  })
}

function params(overrides: { integrationId?: string; jobId?: string } = {}) {
  return {
    params: Promise.resolve({ integrationId: overrides.integrationId ?? INTEGRATION_ID, jobId: overrides.jobId ?? JOB_ID }),
  }
}

function stubAuthOk() {
  vi.mocked(authenticateIntegrationV2).mockResolvedValue({
    integration: { id: INTEGRATION_ID, restaurantId: 'rest-1', status: 'active' } as never,
    t: '1700000000',
    nonce: 'a'.repeat(16),
    replayed: false,
  })
}

describe('GET /api/integrations/{integrationId}/members/jobs/{jobId} (INT-001 WI-3, US-2, T-H4)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(findIntegrationSettingsById).mockResolvedValue(null)
    vi.mocked(getInboundRateLimiter).mockReturnValue({
      takeToken: vi.fn(),
      incrWindow: vi.fn().mockResolvedValue({ allowed: true, count: 1 }),
      incr: vi.fn(),
      decr: vi.fn(),
      get: vi.fn(),
    } as never)
  })

  it('queued job -> 200 { status, submitted_at, attempts }', async () => {
    stubAuthOk()
    vi.mocked(getMemberJob).mockResolvedValue({
      ok: true,
      view: { status: 'queued', submitted_at: '2026-09-10T00:00:00.000Z', attempts: 0 },
    })

    const res = await GET(req(), params())
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json).toEqual({ status: 'queued', submitted_at: '2026-09-10T00:00:00.000Z', attempts: 0 })
  })

  it('unknown job id -> 404 not_found', async () => {
    stubAuthOk()
    vi.mocked(getMemberJob).mockResolvedValue({ ok: false, status: 404, error: 'not_found' })

    const res = await GET(req(), params())
    const json = await res.json()

    expect(res.status).toBe(404)
    expect(json).toEqual({ error: 'not_found' })
  })

  it('a job belonging to another integration -> byte-identical 404 (never 403) -- proven by calling getMemberJob with the OTHER integrationId', async () => {
    stubAuthOk()
    vi.mocked(getMemberJob).mockResolvedValue({ ok: false, status: 404, error: 'not_found' })

    const res = await GET(req(), params({ integrationId: 'int-other' }))
    const json = await res.json()

    expect(res.status).toBe(404)
    expect(json).toEqual({ error: 'not_found' })
    expect(getMemberJob).toHaveBeenCalledWith(JOB_ID, 'int-other', expect.any(Date))
  })

  it('expired result -> 410 result_expired', async () => {
    stubAuthOk()
    vi.mocked(getMemberJob).mockResolvedValue({ ok: false, status: 410, error: 'result_expired' })

    const res = await GET(req(), params())
    const json = await res.json()

    expect(res.status).toBe(410)
    expect(json).toEqual({ error: 'result_expired' })
  })

  it('unsigned/invalid GET -> byte-identical 401, never reaches getMemberJob (job results readable only with the integration secret, US-2)', async () => {
    vi.mocked(authenticateIntegrationV2).mockRejectedValue(new IntegrationAuthErrorV2('bad sig', 401, 'unauthorized'))

    const res = await GET(req(), params())
    const json = await res.json()

    expect(res.status).toBe(401)
    expect(json).toEqual({ error: 'unauthorized' })
    expect(getMemberJob).not.toHaveBeenCalled()
  })
})
