import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../client', () => ({
  createServerSupabaseClient: vi.fn(),
}))

import { createServerSupabaseClient } from '../../client'
import {
  findMemberIdByExternalRef,
  upsertIntegrationMemberRef,
} from '../integration-member-ref-repository'

describe('upsertIntegrationMemberRef', () => {
  beforeEach(() => vi.clearAllMocks())

  it('upserts on (member_id, integration_id)', async () => {
    const upserted: { value: Record<string, unknown> | null; opts?: unknown } = { value: null }
    const upsert = vi.fn().mockImplementation((row: Record<string, unknown>, opts: unknown) => {
      upserted.value = row
      upserted.opts = opts
      return Promise.resolve({ data: null, error: null })
    })
    const from = vi.fn().mockReturnValue({ upsert })
    vi.mocked(createServerSupabaseClient).mockReturnValue({
      from,
    } as unknown as ReturnType<typeof createServerSupabaseClient>)

    await upsertIntegrationMemberRef({
      memberId: 'm-1',
      integrationId: 'int-1',
      externalRef: 'pos-cust-42',
    })

    expect(upserted.value).toMatchObject({
      member_id: 'm-1',
      integration_id: 'int-1',
      external_ref: 'pos-cust-42',
    })
    expect(upserted.opts).toEqual({ onConflict: 'member_id,integration_id' })
  })

  it('throws a contextual error on a database failure', async () => {
    const upsert = vi.fn().mockResolvedValue({ data: null, error: { message: 'conflict' } })
    const from = vi.fn().mockReturnValue({ upsert })
    vi.mocked(createServerSupabaseClient).mockReturnValue({
      from,
    } as unknown as ReturnType<typeof createServerSupabaseClient>)

    await expect(
      upsertIntegrationMemberRef({ memberId: 'm-1', integrationId: 'int-1', externalRef: 'x' })
    ).rejects.toThrow(/upsertIntegrationMemberRef.*conflict/)
  })
})

describe('findMemberIdByExternalRef', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns the member id when found', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: { member_id: 'm-1' }, error: null })
    const eq2 = vi.fn().mockReturnValue({ maybeSingle })
    const eq1 = vi.fn().mockReturnValue({ eq: eq2 })
    const select = vi.fn().mockReturnValue({ eq: eq1 })
    const from = vi.fn().mockReturnValue({ select })
    vi.mocked(createServerSupabaseClient).mockReturnValue({
      from,
    } as unknown as ReturnType<typeof createServerSupabaseClient>)

    const result = await findMemberIdByExternalRef({ integrationId: 'int-1', externalRef: 'x' })
    expect(result).toBe('m-1')
  })

  it('returns null when not found', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
    const eq2 = vi.fn().mockReturnValue({ maybeSingle })
    const eq1 = vi.fn().mockReturnValue({ eq: eq2 })
    const select = vi.fn().mockReturnValue({ eq: eq1 })
    const from = vi.fn().mockReturnValue({ select })
    vi.mocked(createServerSupabaseClient).mockReturnValue({
      from,
    } as unknown as ReturnType<typeof createServerSupabaseClient>)

    const result = await findMemberIdByExternalRef({ integrationId: 'int-1', externalRef: 'missing' })
    expect(result).toBeNull()
  })
})
