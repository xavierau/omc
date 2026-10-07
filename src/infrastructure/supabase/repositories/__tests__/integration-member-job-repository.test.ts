import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../client', () => ({
  createServerSupabaseClient: vi.fn(),
}))

import { createServerSupabaseClient } from '../../client'
import {
  insertMemberJob,
  findMemberJobForIntegration,
  completeMemberJobSucceeded,
  completeMemberJobFailed,
  markMemberJobProcessing,
  updateMemberJobWelcomeOutcome,
  countNonTerminalJobsByIntegration,
  countNonTerminalJobsForIntegration,
} from '../integration-member-job-repository'

function buildInsertClient(insertResult: { data: unknown; error: { code?: string; message: string } | null }) {
  const inserted: { value: Record<string, unknown> | null } = { value: null }
  const single = vi.fn().mockResolvedValue(insertResult)
  const select = vi.fn().mockReturnValue({ single })
  const insert = vi.fn().mockImplementation((row: Record<string, unknown>) => {
    inserted.value = row
    return { select }
  })
  const from = vi.fn().mockReturnValue({ insert })
  return { client: { from } as unknown as ReturnType<typeof createServerSupabaseClient>, inserted }
}

function buildScopedSelectClient(selectResult: { data: unknown; error: { message: string } | null }) {
  const eqs: Array<{ col: string; val: unknown }> = []
  const maybeSingle = vi.fn().mockResolvedValue(selectResult)
  const eq2 = vi.fn().mockImplementation((col: string, val: unknown) => {
    eqs.push({ col, val })
    return { maybeSingle }
  })
  const eq1 = vi.fn().mockImplementation((col: string, val: unknown) => {
    eqs.push({ col, val })
    return { eq: eq2, maybeSingle }
  })
  const select = vi.fn().mockReturnValue({ eq: eq1 })
  const from = vi.fn().mockReturnValue({ select })
  return { client: { from } as unknown as ReturnType<typeof createServerSupabaseClient>, eqs }
}

function buildUpdateClient() {
  const updated: { value: Record<string, unknown> | null; eqCol: string | null; eqVal: unknown } = {
    value: null,
    eqCol: null,
    eqVal: null,
  }
  const eq = vi.fn().mockImplementation((col: string, val: unknown) => {
    updated.eqCol = col
    updated.eqVal = val
    return Promise.resolve({ error: null })
  })
  const update = vi.fn().mockImplementation((row: Record<string, unknown>) => {
    updated.value = row
    return { eq }
  })
  const from = vi.fn().mockReturnValue({ update })
  return { client: { from } as unknown as ReturnType<typeof createServerSupabaseClient>, updated }
}

const BASE_ARGS = {
  jobId: 'mj_abc',
  integrationId: 'int-1',
  restaurantId: 'rest-1',
  assertedLevel: 'all' as const,
  sendWelcome: true,
  metadata: null,
  externalRef: null,
  phoneLast4: '5432',
}

describe('integration-member-job-repository (INT-001 WI-3, T-H3b/T-H4/T-M1)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('insertMemberJob: fresh insert returns inserted:true with the new row, no phone/name on the row', async () => {
    const { client, inserted } = buildInsertClient({
      data: { job_id: 'mj_abc', integration_id: 'int-1', restaurant_id: 'rest-1', status: 'queued' },
      error: null,
    })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    const result = await insertMemberJob(BASE_ARGS)

    expect(result.inserted).toBe(true)
    expect(result.row.job_id).toBe('mj_abc')
    // T-M1: the insert payload itself carries no full phone or name key.
    expect(Object.keys(inserted.value ?? {})).not.toContain('phone')
    expect(Object.keys(inserted.value ?? {})).not.toContain('name')
    expect(inserted.value?.phone_last4).toBe('5432')
  })

  it('insertMemberJob: 23505 on job_id PK -> re-selects and returns inserted:false (T-H3b idempotent resubmission)', async () => {
    const { client: insertClient } = buildInsertClient({
      data: null,
      error: { code: '23505', message: 'duplicate key value violates unique constraint' },
    })
    const { client: selectClient, eqs } = buildScopedSelectClient({
      data: { job_id: 'mj_abc', integration_id: 'int-1', restaurant_id: 'rest-1', status: 'processing' },
      error: null,
    })
    vi.mocked(createServerSupabaseClient).mockReturnValueOnce(insertClient).mockReturnValueOnce(selectClient)

    const result = await insertMemberJob(BASE_ARGS)

    expect(result.inserted).toBe(false)
    expect(result.row.status).toBe('processing')
    expect(eqs).toEqual([{ col: 'job_id', val: 'mj_abc' }])
  })

  it('findMemberJobForIntegration: scopes by BOTH job_id and integration_id (T-H4)', async () => {
    const { client, eqs } = buildScopedSelectClient({
      data: { job_id: 'mj_abc', integration_id: 'int-1', status: 'succeeded' },
      error: null,
    })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    const row = await findMemberJobForIntegration('mj_abc', 'int-1')

    expect(row?.status).toBe('succeeded')
    expect(eqs).toEqual([
      { col: 'job_id', val: 'mj_abc' },
      { col: 'integration_id', val: 'int-1' },
    ])
  })

  it('findMemberJobForIntegration: a job scoped to a DIFFERENT integration reads as null (foreign = unknown)', async () => {
    const { client } = buildScopedSelectClient({ data: null, error: null })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    const row = await findMemberJobForIntegration('mj_abc', 'int-other')

    expect(row).toBeNull()
  })

  it('completeMemberJobSucceeded writes status/outcome/member_id/consent/welcome fields', async () => {
    const { client, updated } = buildUpdateClient()
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    await completeMemberJobSucceeded({
      jobId: 'mj_abc',
      outcome: 'created',
      memberId: 'm-1',
      consentActions: { utility: 'inserted', marketing: 'inserted' },
      welcomeOutcome: 'skipped_off',
      welcomeDetail: null,
      completedAt: '2026-09-10T00:00:00.000Z',
      resultExpiresAt: '2026-09-11T00:00:00.000Z',
    })

    expect(updated.value).toMatchObject({ status: 'succeeded', outcome: 'created', member_id: 'm-1' })
    expect(updated.eqCol).toBe('job_id')
    expect(updated.eqVal).toBe('mj_abc')
  })

  it('completeMemberJobFailed writes status:failed with a structured error, never the raw phone', async () => {
    const { client, updated } = buildUpdateClient()
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    await completeMemberJobFailed({
      jobId: 'mj_abc',
      errorCode: 'internal',
      errorMessage: 'transient DB error',
      completedAt: '2026-09-10T00:00:00.000Z',
      resultExpiresAt: '2026-09-11T00:00:00.000Z',
    })

    expect(updated.value).toMatchObject({ status: 'failed', error_code: 'internal' })
    expect(JSON.stringify(updated.value)).not.toMatch(/\+\d{6,}/)
  })

  it('markMemberJobProcessing bumps attempts and stamps started_at', async () => {
    const { client, updated } = buildUpdateClient()
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    await markMemberJobProcessing('mj_abc', '2026-09-10T00:00:01.000Z', 2)

    expect(updated.value).toEqual({
      status: 'processing',
      started_at: '2026-09-10T00:00:01.000Z',
      attempts: 2,
    })
  })

  it('updateMemberJobWelcomeOutcome (INT-001 WI-4) writes ONLY welcome_outcome/welcome_detail, scoped by job_id', async () => {
    const { client, updated } = buildUpdateClient()
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    await updateMemberJobWelcomeOutcome('mj_abc', 'sent', { whatsapp_message_id: 'wamid.123' })

    expect(updated.value).toEqual({
      welcome_outcome: 'sent',
      welcome_detail: { whatsapp_message_id: 'wamid.123' },
    })
    expect(updated.eqCol).toBe('job_id')
    expect(updated.eqVal).toBe('mj_abc')
  })

  it('updateMemberJobWelcomeOutcome accepts a null detail (the common skip case)', async () => {
    const { client, updated } = buildUpdateClient()
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    await updateMemberJobWelcomeOutcome('mj_abc', 'skipped_opted_out', null)

    expect(updated.value).toEqual({ welcome_outcome: 'skipped_opted_out', welcome_detail: null })
  })
})

describe('countNonTerminalJobsByIntegration / countNonTerminalJobsForIntegration (INT-001 WI-13 Gap B)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('countNonTerminalJobsByIntegration maps the grouped RPC rows to camelCase', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [
        { integration_id: 'int-1', non_terminal_count: 3 },
        { integration_id: 'int-2', non_terminal_count: 0 },
      ],
      error: null,
    })
    vi.mocked(createServerSupabaseClient).mockReturnValue({
      rpc,
    } as unknown as ReturnType<typeof createServerSupabaseClient>)

    const result = await countNonTerminalJobsByIntegration()

    expect(rpc).toHaveBeenCalledWith('count_non_terminal_member_jobs_by_integration')
    expect(result).toEqual([
      { integrationId: 'int-1', count: 3 },
      { integrationId: 'int-2', count: 0 },
    ])
  })

  it('countNonTerminalJobsByIntegration returns [] when the RPC returns no rows', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null })
    vi.mocked(createServerSupabaseClient).mockReturnValue({
      rpc,
    } as unknown as ReturnType<typeof createServerSupabaseClient>)

    expect(await countNonTerminalJobsByIntegration()).toEqual([])
  })

  it('countNonTerminalJobsByIntegration throws a contextual error on failure', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'timeout' } })
    vi.mocked(createServerSupabaseClient).mockReturnValue({
      rpc,
    } as unknown as ReturnType<typeof createServerSupabaseClient>)

    await expect(countNonTerminalJobsByIntegration()).rejects.toThrow(
      /countNonTerminalJobsByIntegration.*timeout/
    )
  })

  it('countNonTerminalJobsForIntegration passes the integration id and returns the count', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: 5, error: null })
    vi.mocked(createServerSupabaseClient).mockReturnValue({
      rpc,
    } as unknown as ReturnType<typeof createServerSupabaseClient>)

    const result = await countNonTerminalJobsForIntegration('int-1')

    expect(rpc).toHaveBeenCalledWith('count_non_terminal_member_jobs_for_integration', {
      p_integration_id: 'int-1',
    })
    expect(result).toBe(5)
  })

  it('countNonTerminalJobsForIntegration returns 0 when the RPC returns null', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null })
    vi.mocked(createServerSupabaseClient).mockReturnValue({
      rpc,
    } as unknown as ReturnType<typeof createServerSupabaseClient>)

    expect(await countNonTerminalJobsForIntegration('int-1')).toBe(0)
  })

  it('countNonTerminalJobsForIntegration throws a contextual error on failure', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'permission denied' } })
    vi.mocked(createServerSupabaseClient).mockReturnValue({
      rpc,
    } as unknown as ReturnType<typeof createServerSupabaseClient>)

    await expect(countNonTerminalJobsForIntegration('int-1')).rejects.toThrow(
      /countNonTerminalJobsForIntegration.*permission denied/
    )
  })
})
