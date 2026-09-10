// INT-001 WI-3: frozen acceptance suite for `getMemberJob` (spec US-2, T-H4).

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/infrastructure/supabase/repositories/integration-member-job-repository')

import { getMemberJob } from '../get-member-job'
import {
  findMemberJobForIntegration,
  type MemberJobRow,
} from '@/infrastructure/supabase/repositories/integration-member-job-repository'

function row(overrides: Partial<MemberJobRow> = {}): MemberJobRow {
  return {
    job_id: 'mj_abc',
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

describe('getMemberJob (INT-001 WI-3, US-2, T-H4)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('queued job -> 200 { status, submitted_at, attempts }', async () => {
    vi.mocked(findMemberJobForIntegration).mockResolvedValue(row({ status: 'queued', attempts: 1 }))

    const result = await getMemberJob('mj_abc', 'int-1', new Date('2026-09-10T00:00:01Z'))

    expect(result).toEqual({
      ok: true,
      view: { status: 'queued', submitted_at: '2026-09-10T00:00:00.000Z', attempts: 1 },
    })
  })

  it('succeeded job -> 200 { status, member_id, outcome }, never a coupon/consent/welcome field (OD-11)', async () => {
    vi.mocked(findMemberJobForIntegration).mockResolvedValue(
      row({
        status: 'succeeded',
        outcome: 'created',
        member_id: 'm-1',
        consent_actions: { utility: 'inserted' },
        welcome_outcome: 'queued',
        result_expires_at: '2026-09-11T00:00:00.000Z',
      })
    )

    const result = await getMemberJob('mj_abc', 'int-1', new Date('2026-09-10T01:00:00Z'))

    expect(result).toEqual({ ok: true, view: { status: 'succeeded', member_id: 'm-1', outcome: 'created' } })
    expect(JSON.stringify(result)).not.toContain('consent_actions')
    expect(JSON.stringify(result)).not.toContain('welcome_outcome')
  })

  it('failed job -> 200 { status, error: { code, message } }', async () => {
    vi.mocked(findMemberJobForIntegration).mockResolvedValue(
      row({
        status: 'failed',
        error_code: 'tenant_inactive',
        error_message: 'tenant_inactive',
        result_expires_at: '2026-09-11T00:00:00.000Z',
      })
    )

    const result = await getMemberJob('mj_abc', 'int-1', new Date('2026-09-10T01:00:00Z'))

    expect(result).toEqual({
      ok: true,
      view: { status: 'failed', error: { code: 'tenant_inactive', message: 'tenant_inactive' } },
    })
  })

  it('unknown job id -> 404 not_found', async () => {
    vi.mocked(findMemberJobForIntegration).mockResolvedValue(null)

    const result = await getMemberJob('mj_unknown', 'int-1', new Date())

    expect(result).toEqual({ ok: false, status: 404, error: 'not_found' })
  })

  it('a job belonging to another integration -> byte-identical 404 not_found (T-H4, never 403)', async () => {
    // The repository layer already returns null for a foreign job -- this
    // proves getMemberJob does not special-case that in any way that could
    // leak a different status code or body shape.
    vi.mocked(findMemberJobForIntegration).mockResolvedValue(null)

    const own = await getMemberJob('mj_abc', 'int-mine', new Date())
    const foreign = await getMemberJob('mj_abc', 'int-other', new Date())

    expect(own).toEqual(foreign)
    expect(own).toEqual({ ok: false, status: 404, error: 'not_found' })
  })

  it('a succeeded job past result_expires_at -> 410 result_expired', async () => {
    vi.mocked(findMemberJobForIntegration).mockResolvedValue(
      row({ status: 'succeeded', outcome: 'existing', member_id: 'm-1', result_expires_at: '2026-09-10T00:00:00.000Z' })
    )

    const result = await getMemberJob('mj_abc', 'int-1', new Date('2026-09-11T00:00:01Z'))

    expect(result).toEqual({ ok: false, status: 410, error: 'result_expired' })
  })

  it('a queued job (result_expires_at still null) is never treated as expired', async () => {
    vi.mocked(findMemberJobForIntegration).mockResolvedValue(row({ status: 'queued', result_expires_at: null }))

    const result = await getMemberJob('mj_abc', 'int-1', new Date('2099-01-01T00:00:00Z'))

    expect(result.ok).toBe(true)
  })
})
