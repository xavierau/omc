import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../client', () => ({
  createServerSupabaseClient: vi.fn(),
}))

import { createServerSupabaseClient } from '../../client'
import {
  findExternalRefForMember,
  findMemberIdByExternalRef,
  upsertIntegrationMemberRef,
} from '../integration-member-ref-repository'

describe('upsertIntegrationMemberRef', () => {
  beforeEach(() => vi.clearAllMocks())

  // WI-13 (Gap A): the plain .upsert() call was replaced by an RPC
  // (upsert_member_ref_with_origin, migration 073) that also attributes the
  // resulting member.updated event to the calling integration -- see
  // migration 073's header for why a plain .upsert() can't do that.
  it('calls upsert_member_ref_with_origin with (member_id, integration_id, external_ref)', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null })
    vi.mocked(createServerSupabaseClient).mockReturnValue({
      rpc,
    } as unknown as ReturnType<typeof createServerSupabaseClient>)

    await upsertIntegrationMemberRef({
      memberId: 'm-1',
      integrationId: 'int-1',
      externalRef: 'pos-cust-42',
    })

    expect(rpc).toHaveBeenCalledWith('upsert_member_ref_with_origin', {
      p_member_id: 'm-1',
      p_integration_id: 'int-1',
      p_external_ref: 'pos-cust-42',
    })
  })

  it('throws a contextual error on a database failure', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'conflict' } })
    vi.mocked(createServerSupabaseClient).mockReturnValue({
      rpc,
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

describe('findExternalRefForMember (WI-6, build-outbound-payload)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns the external_ref when a ref row exists for (member, integration)', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: { external_ref: 'pos-cust-42' }, error: null })
    const eq2 = vi.fn().mockReturnValue({ maybeSingle })
    const eq1 = vi.fn().mockReturnValue({ eq: eq2 })
    const select = vi.fn().mockReturnValue({ eq: eq1 })
    const from = vi.fn().mockReturnValue({ select })
    vi.mocked(createServerSupabaseClient).mockReturnValue({
      from,
    } as unknown as ReturnType<typeof createServerSupabaseClient>)

    const result = await findExternalRefForMember({ memberId: 'm-1', integrationId: 'int-1' })
    expect(result).toBe('pos-cust-42')
    expect(eq1).toHaveBeenCalledWith('member_id', 'm-1')
    expect(eq2).toHaveBeenCalledWith('integration_id', 'int-1')
  })

  it('returns null when no ref row exists', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
    const eq2 = vi.fn().mockReturnValue({ maybeSingle })
    const eq1 = vi.fn().mockReturnValue({ eq: eq2 })
    const select = vi.fn().mockReturnValue({ eq: eq1 })
    const from = vi.fn().mockReturnValue({ select })
    vi.mocked(createServerSupabaseClient).mockReturnValue({
      from,
    } as unknown as ReturnType<typeof createServerSupabaseClient>)

    const result = await findExternalRefForMember({ memberId: 'm-1', integrationId: 'int-1' })
    expect(result).toBeNull()
  })

  it('throws a contextual error on a database failure', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: { message: 'timeout' } })
    const eq2 = vi.fn().mockReturnValue({ maybeSingle })
    const eq1 = vi.fn().mockReturnValue({ eq: eq2 })
    const select = vi.fn().mockReturnValue({ eq: eq1 })
    const from = vi.fn().mockReturnValue({ select })
    vi.mocked(createServerSupabaseClient).mockReturnValue({
      from,
    } as unknown as ReturnType<typeof createServerSupabaseClient>)

    await expect(
      findExternalRefForMember({ memberId: 'm-1', integrationId: 'int-1' })
    ).rejects.toThrow(/findExternalRefForMember.*timeout/)
  })
})
