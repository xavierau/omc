import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/infrastructure/supabase/repositories/integration-member-job-repository')

import { findMemberJobsForIntegration } from '@/infrastructure/supabase/repositories/integration-member-job-repository'
import { listIntegrationActivity } from '../list-integration-activity'

beforeEach(() => {
  vi.clearAllMocks()
})

function jobRow(overrides: Partial<Awaited<ReturnType<typeof findMemberJobsForIntegration>>[number]> = {}) {
  return {
    job_id: 'job-1',
    integration_id: 'int-1',
    restaurant_id: 'rest-1',
    status: 'succeeded' as const,
    outcome: 'created' as const,
    member_id: 'mem-1',
    error_code: null,
    error_message: null,
    attempts: 1,
    asserted_level: 'all' as const,
    send_welcome: true,
    consent_actions: { utility: 'inserted', marketing: 'inserted' },
    welcome_outcome: 'queued',
    welcome_detail: null,
    metadata: null,
    external_ref: null,
    phone_last4: '5432',
    submitted_at: '2026-09-10T00:00:00Z',
    started_at: '2026-09-10T00:00:01Z',
    completed_at: '2026-09-10T00:00:02Z',
    result_expires_at: '2026-09-11T00:00:00Z',
    ...overrides,
  }
}

describe('listIntegrationActivity', () => {
  it('never includes the full phone -- only phone_last4', async () => {
    vi.mocked(findMemberJobsForIntegration).mockResolvedValue([jobRow()])

    const result = await listIntegrationActivity('int-1', 'rest-1', {})

    expect(result.data[0]).toEqual({
      jobId: 'job-1',
      status: 'succeeded',
      outcome: 'created',
      assertedLevel: 'all',
      consentActions: { utility: 'inserted', marketing: 'inserted' },
      welcomeOutcome: 'queued',
      welcomeDetail: null,
      phoneLast4: '5432',
      submittedAt: '2026-09-10T00:00:00Z',
    })
    expect(Object.keys(result.data[0])).not.toContain('phone')
    expect(JSON.stringify(result.data[0])).not.toMatch(/\+?\d{8,}/)
  })

  it('scopes the repository call by both integrationId and restaurantId', async () => {
    vi.mocked(findMemberJobsForIntegration).mockResolvedValue([])

    await listIntegrationActivity('int-1', 'rest-1', { cursor: 'c1' })

    expect(findMemberJobsForIntegration).toHaveBeenCalledWith('int-1', 'rest-1', { cursor: 'c1', limit: 50 })
  })

  it('returns nextCursor only when the page was full', async () => {
    vi.mocked(findMemberJobsForIntegration).mockResolvedValue([jobRow({ submitted_at: '2026-09-10T02:00:00Z' })])
    const full = await listIntegrationActivity('int-1', 'rest-1', { limit: 1 })
    expect(full.nextCursor).toBe('2026-09-10T02:00:00Z')
  })
})
