// INT-001 WI-3: frozen acceptance suite for `enqueueMemberCreate`
// (plan §"Job id + idempotency", §"Per-integration queue-depth cap",
// kanban INT-001 CONSTRAINT). Uses the REAL `FakeRateLimiter` +
// `GlobalQueueCeilingGuard` (WI-1/WI-2's fakes/classes) rather than mocking
// them, and mocks only the Postgres repository boundary.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/infrastructure/supabase/repositories/integration-member-job-repository')

import { FakeRateLimiter } from '@/test-utils/fake-rate-limiter'
import { FakeClock } from '@/test-utils/fake-clock'
import { GlobalQueueCeilingGuard, type QueueDepthSource } from '../check-global-queue-ceiling'
import { enqueueMemberCreate, type EnqueueMemberCreateInput } from '../enqueue-member-create'
import {
  insertMemberJob,
  findMemberJobForIntegration,
  type MemberJobRow,
} from '@/infrastructure/supabase/repositories/integration-member-job-repository'
import type { MemberCreateJobData } from '@/infrastructure/queue/integration-inbound-queue'

const JOB_ID_KEY = 'test-job-id-key'

function baseInput(overrides: Partial<EnqueueMemberCreateInput> = {}): EnqueueMemberCreateInput {
  return {
    integrationId: 'int-1',
    restaurantId: 'rest-1',
    phoneE164: '+85298765432',
    phoneLast4: '5432',
    consentLevel: 'all',
    name: 'Ada',
    externalRef: null,
    language: null,
    sendWelcome: true,
    metadata: null,
    queueCap: 500,
    ...overrides,
  }
}

type AddMemberCreateJobMock = ReturnType<typeof vi.fn<(data: MemberCreateJobData) => Promise<void>>>

function buildDeps(overrides: { depth?: number; addMemberCreateJob?: AddMemberCreateJobMock } = {}) {
  const clock = new FakeClock()
  const rateLimiter = new FakeRateLimiter(clock)
  const depthSource: QueueDepthSource = { getDepth: async () => overrides.depth ?? 0 }
  const globalCeilingGuard = new GlobalQueueCeilingGuard(depthSource, clock, 5000)
  const addMemberCreateJob: AddMemberCreateJobMock = overrides.addMemberCreateJob ?? vi.fn().mockResolvedValue(undefined)
  return { rateLimiter, globalCeilingGuard, addMemberCreateJob, jobIdKey: JOB_ID_KEY, clock }
}

function row(overrides: Partial<MemberJobRow> = {}): MemberJobRow {
  return {
    job_id: 'mj_x',
    integration_id: 'int-1',
    restaurant_id: 'rest-1',
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
    ...overrides,
  }
}

describe('enqueueMemberCreate (INT-001 WI-3, T-H3a/b, T-M7, kanban CONSTRAINT)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('fresh submission: reserves depth, writes the job row, enqueues, returns 202 queued', async () => {
    vi.mocked(insertMemberJob).mockResolvedValue({ inserted: true, row: row({ status: 'queued' }) })
    const deps = buildDeps()

    const result = await enqueueMemberCreate(baseInput(), deps)

    expect(result).toEqual({ ok: true, jobId: expect.stringMatching(/^mj_/), status: 'queued' })
    expect(insertMemberJob).toHaveBeenCalledTimes(1)
    expect(deps.addMemberCreateJob).toHaveBeenCalledTimes(1)
  })

  it('same body twice -> the same job_id, no second Postgres insert, no second q.add (T-H3b)', async () => {
    vi.mocked(insertMemberJob).mockResolvedValue({ inserted: true, row: row({ status: 'queued' }) })
    vi.mocked(findMemberJobForIntegration).mockResolvedValue(row({ status: 'processing' }))
    const deps = buildDeps()

    const first = await enqueueMemberCreate(baseInput(), deps)
    const second = await enqueueMemberCreate(baseInput(), deps)

    expect(first.ok && second.ok).toBe(true)
    if (!first.ok || !second.ok) throw new Error('unreachable')
    expect(second.jobId).toBe(first.jobId)
    expect(second.status).toBe('processing')
    expect(insertMemberJob).toHaveBeenCalledTimes(1)
    expect(deps.addMemberCreateJob).toHaveBeenCalledTimes(1)
  })

  it('same phone with a raised consent_level -> a DIFFERENT job_id (a genuinely new job)', async () => {
    vi.mocked(insertMemberJob).mockResolvedValue({ inserted: true, row: row({ status: 'queued' }) })
    const deps = buildDeps()

    const first = await enqueueMemberCreate(baseInput({ consentLevel: 'utility' }), deps)
    const second = await enqueueMemberCreate(baseInput({ consentLevel: 'all' }), deps)

    expect(first.ok && second.ok).toBe(true)
    if (!first.ok || !second.ok) throw new Error('unreachable')
    expect(second.jobId).not.toBe(first.jobId)
    expect(insertMemberJob).toHaveBeenCalledTimes(2)
  })

  it('per-integration depth at cap -> 503 queue_depth_exceeded, reservation released, zero DB writes', async () => {
    const deps = buildDeps()
    await deps.rateLimiter.incr('int001:depth:int-1') // pre-fill to the cap

    const result = await enqueueMemberCreate(baseInput({ queueCap: 1 }), deps)

    expect(result).toEqual({ ok: false, status: 503, error: 'queue_depth_exceeded' })
    expect(insertMemberJob).not.toHaveBeenCalled()
    expect(await deps.rateLimiter.get('int001:depth:int-1')).toBe(1) // released back to the pre-fill level
  })

  it('global ceiling exceeded -> 503 queue_depth_exceeded, per-integration reservation released', async () => {
    const deps = buildDeps({ depth: 6000 })

    const result = await enqueueMemberCreate(baseInput(), deps)

    expect(result).toEqual({ ok: false, status: 503, error: 'queue_depth_exceeded' })
    expect(insertMemberJob).not.toHaveBeenCalled()
    expect(await deps.rateLimiter.get('int001:depth:int-1')).toBe(0)
  })

  it('q.add failure -> 503 queue_unavailable, depth reservation released (job row stays queued for a self-healing retry)', async () => {
    vi.mocked(insertMemberJob).mockResolvedValue({ inserted: true, row: row({ status: 'queued' }) })
    const deps = buildDeps({ addMemberCreateJob: vi.fn().mockRejectedValue(new Error('redis down')) })

    const result = await enqueueMemberCreate(baseInput(), deps)

    expect(result).toEqual({ ok: false, status: 503, error: 'queue_unavailable' })
    expect(await deps.rateLimiter.get('int001:depth:int-1')).toBe(0)
  })

  it('Redis unavailable at the very first (idempotency) check -> 503 queue_unavailable, zero DB writes', async () => {
    const deps = buildDeps()
    deps.rateLimiter.incrWindow = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'))

    const result = await enqueueMemberCreate(baseInput(), deps)

    expect(result).toEqual({ ok: false, status: 503, error: 'queue_unavailable' })
    expect(insertMemberJob).not.toHaveBeenCalled()
    expect(deps.addMemberCreateJob).not.toHaveBeenCalled()
  })

  it('a concurrent duplicate whose Postgres insert wins the race: the loser releases depth and reports the winner row without re-adding to the queue', async () => {
    vi.mocked(insertMemberJob).mockResolvedValue({ inserted: false, row: row({ status: 'queued' }) })
    const deps = buildDeps()

    const result = await enqueueMemberCreate(baseInput(), deps)

    expect(result).toEqual({ ok: true, jobId: expect.stringMatching(/^mj_/), status: 'queued' })
    expect(deps.addMemberCreateJob).not.toHaveBeenCalled()
    expect(await deps.rateLimiter.get('int001:depth:int-1')).toBe(0)
  })
})
