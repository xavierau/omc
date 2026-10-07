// INT-001 WI-14 (I-6): `member-create` job payloads carry phone/name/
// metadata (the request body, normalised -- see integration-inbound-queue.ts's
// own header); `welcome-send` payloads are ids-only. Both queues used to
// share the SAME 7-day `removeOnFail` retention, which left partner-
// submitted PII sitting in Redis's failed set for a week after every
// exhausted create -- far longer than ops needs for triage (the Postgres
// `integration_member_jobs` row already holds phone_last4 + error code).
// This file proves the two job types now get DIFFERENT retention.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockAdd, MockQueue } = vi.hoisted(() => {
  const mockAdd = vi.fn().mockResolvedValue(undefined)

  class MockQueue {
    add = mockAdd
  }

  return { mockAdd, MockQueue }
})

vi.mock('bullmq', () => ({ Queue: MockQueue, Worker: class {} }))
vi.mock('ioredis', () => ({ Redis: class {} }))

import { addMemberCreateJob, addWelcomeSendJob } from '../integration-inbound-queue'

const MEMBER_CREATE_DATA = {
  jobId: 'mj_1',
  integrationId: 'int-1',
  restaurantId: 'rest-1',
  phoneE164: '+85298765432',
  consentLevel: 'all' as const,
  name: 'Ada',
  externalRef: null,
  language: null,
  sendWelcome: true,
  metadata: null,
}

const WELCOME_SEND_DATA = {
  memberId: 'm-1',
  restaurantId: 'rest-1',
  integrationId: 'int-1',
  createJobId: 'mj_1',
}

describe('addMemberCreateJob / addWelcomeSendJob removeOnFail retention (I-6)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('I-6: member-create (PII-bearing payload) uses a SHORT removeOnFail age -- down from the pre-fix 7 days', async () => {
    await addMemberCreateJob(MEMBER_CREATE_DATA)

    const opts = mockAdd.mock.calls[0][2] as { removeOnFail: { count: number; age: number } }
    expect(opts.removeOnFail.age).toBeLessThan(7 * 24 * 3600)
    // Explicitly not the old 7-day value -- pins the fix, not just "some smaller number".
    expect(opts.removeOnFail.age).not.toBe(7 * 24 * 3600)
  })

  it('I-6: welcome-send (ids-only payload) KEEPS the 7-day removeOnFail age -- T-H7 already satisfied for this queue', async () => {
    await addWelcomeSendJob('mj_1', WELCOME_SEND_DATA)

    const opts = mockAdd.mock.calls[0][2] as { removeOnFail: { count: number; age: number } }
    expect(opts.removeOnFail.age).toBe(7 * 24 * 3600)
  })

  it('member-create job data still carries only the normalised fields (unchanged wiring) -- retention is the only thing this fix touches', async () => {
    await addMemberCreateJob(MEMBER_CREATE_DATA)

    const [name, data, opts] = mockAdd.mock.calls[0] as [string, Record<string, unknown>, { jobId: string }]
    expect(name).toBe('member-create')
    expect(data).toEqual(MEMBER_CREATE_DATA)
    expect(opts.jobId).toBe('mj_1')
  })
})
