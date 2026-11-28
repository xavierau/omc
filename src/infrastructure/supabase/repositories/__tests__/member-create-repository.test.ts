import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../client', () => ({
  createServerSupabaseClient: vi.fn(),
}))

import { createServerSupabaseClient } from '../../client'
import { insertMember } from '../member-create-repository'

function buildInsertClient(
  insertResult: { data: { id: string; status: string } | null; error: { code?: string; message: string } | null }
) {
  const inserted: { value: Record<string, unknown> | null } = { value: null }
  const single = vi.fn().mockResolvedValue(insertResult)
  const select = vi.fn().mockReturnValue({ single })
  const insert = vi.fn().mockImplementation((row: Record<string, unknown>) => {
    inserted.value = row
    return { select }
  })
  const from = vi.fn().mockReturnValue({ insert })
  return {
    client: { from } as unknown as ReturnType<typeof createServerSupabaseClient>,
    inserted,
  }
}

function buildReselectClient(
  selectResult: { data: { id: string; status: string } | null; error: { message: string } | null }
) {
  const eqs: Array<{ col: string; val: unknown }> = []
  const maybeSingle = vi.fn().mockResolvedValue(selectResult)
  const eq2 = vi.fn().mockImplementation((col: string, val: unknown) => {
    eqs.push({ col, val })
    return { maybeSingle }
  })
  const eq1 = vi.fn().mockImplementation((col: string, val: unknown) => {
    eqs.push({ col, val })
    return { eq: eq2 }
  })
  const select = vi.fn().mockReturnValue({ eq: eq1 })
  const from = vi.fn().mockReturnValue({ select })
  return {
    client: { from } as unknown as ReturnType<typeof createServerSupabaseClient>,
    eqs,
  }
}

describe('insertMember (INT-001 T-H6 seam repository)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns created with the new row on a clean insert', async () => {
    const { client, inserted } = buildInsertClient({
      data: { id: 'm-1', status: 'active' },
      error: null,
    })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    const result = await insertMember({
      restaurantId: 'r-1',
      phoneE164: '+85298765432',
      name: 'Ada',
      preferredLanguage: 'en',
    })

    expect(result).toEqual({ outcome: 'created', memberId: 'm-1', status: 'active' })
    expect(inserted.value).toMatchObject({
      restaurant_id: 'r-1',
      phone: '+85298765432',
      name: 'Ada',
      preferred_language: 'en',
    })
  })

  it('INT-001 WI-3: stamps status active and a fresh 32-hex loyalty_token, matching every other member-insert path', async () => {
    const { client, inserted } = buildInsertClient({
      data: { id: 'm-1', status: 'active' },
      error: null,
    })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    await insertMember({
      restaurantId: 'r-1',
      phoneE164: '+85298765432',
      name: 'Ada',
      preferredLanguage: 'en',
    })

    expect(inserted.value?.status).toBe('active')
    expect(inserted.value?.loyalty_token).toMatch(/^[0-9a-f]{32}$/)
  })

  it('23505 -> re-selects and returns existing (never a thrown error)', async () => {
    const { client: insertClient } = buildInsertClient({
      data: null,
      error: { code: '23505', message: 'duplicate key value violates unique constraint "idx_members_restaurant_phone"' },
    })
    const { client: selectClient, eqs } = buildReselectClient({
      data: { id: 'm-existing', status: 'active' },
      error: null,
    })
    vi.mocked(createServerSupabaseClient)
      .mockReturnValueOnce(insertClient)
      .mockReturnValueOnce(selectClient)

    const result = await insertMember({
      restaurantId: 'r-1',
      phoneE164: '+85298765432',
      name: 'Ada',
      preferredLanguage: 'en',
    })

    expect(result).toEqual({ outcome: 'existing', memberId: 'm-existing', status: 'active' })
    expect(eqs).toEqual([
      { col: 'restaurant_id', val: 'r-1' },
      { col: 'phone', val: '+85298765432' },
    ])
  })

  it('OD-2(b): an existing unsubscribed member is returned as-is, never reactivated', async () => {
    const { client: insertClient } = buildInsertClient({
      data: null,
      error: { code: '23505', message: 'duplicate key' },
    })
    const { client: selectClient } = buildReselectClient({
      data: { id: 'm-unsub', status: 'unsubscribed' },
      error: null,
    })
    vi.mocked(createServerSupabaseClient)
      .mockReturnValueOnce(insertClient)
      .mockReturnValueOnce(selectClient)

    const result = await insertMember({
      restaurantId: 'r-1',
      phoneE164: '+85298765432',
      name: null,
      preferredLanguage: null,
    })

    expect(result).toEqual({
      outcome: 'existing',
      memberId: 'm-unsub',
      status: 'unsubscribed',
    })
    // No update chain was ever requested from the select client's `from()` —
    // only `.select()` was used, proving nothing was written.
    const fromMock = (selectClient as unknown as { from: ReturnType<typeof vi.fn> }).from
    expect(fromMock).toHaveBeenCalledTimes(1)
  })

  it('throws when 23505 fires but the re-select finds no row', async () => {
    const { client: insertClient } = buildInsertClient({
      data: null,
      error: { code: '23505', message: 'duplicate key' },
    })
    const { client: selectClient } = buildReselectClient({ data: null, error: null })
    vi.mocked(createServerSupabaseClient)
      .mockReturnValueOnce(insertClient)
      .mockReturnValueOnce(selectClient)

    await expect(
      insertMember({
        restaurantId: 'r-1',
        phoneE164: '+85298765432',
        name: null,
        preferredLanguage: null,
      })
    ).rejects.toThrow(/no row found on re-select/)
  })

  it('throws a contextual error for non-23505 database errors', async () => {
    const { client } = buildInsertClient({
      data: null,
      error: { code: '42501', message: 'permission denied' },
    })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    await expect(
      insertMember({
        restaurantId: 'r-1',
        phoneE164: '+85298765432',
        name: null,
        preferredLanguage: null,
      })
    ).rejects.toThrow(/insertMember.*permission denied/)
  })

  it('concurrent double-create: two calls for the same phone resolve to one created + one existing, same memberId', async () => {
    // Simulates two requests racing on the same (restaurant, phone): the
    // first insert wins, the second hits 23505 (the real unique index would
    // do this atomically in Postgres) and re-selects the winner's row.
    const { client: winnerInsertClient } = buildInsertClient({
      data: { id: 'm-race', status: 'active' },
      error: null,
    })
    const { client: loserInsertClient } = buildInsertClient({
      data: null,
      error: { code: '23505', message: 'duplicate key' },
    })
    const { client: loserReselectClient } = buildReselectClient({
      data: { id: 'm-race', status: 'active' },
      error: null,
    })

    vi.mocked(createServerSupabaseClient)
      .mockReturnValueOnce(winnerInsertClient) // call A's insert
      .mockReturnValueOnce(loserInsertClient) // call B's insert
      .mockReturnValueOnce(loserReselectClient) // call B's re-select

    const [resultA, resultB] = await Promise.all([
      insertMember({
        restaurantId: 'r-1',
        phoneE164: '+85298765432',
        name: 'Ada',
        preferredLanguage: 'en',
      }),
      insertMember({
        restaurantId: 'r-1',
        phoneE164: '+85298765432',
        name: 'Ada',
        preferredLanguage: 'en',
      }),
    ])

    const outcomes = [resultA.outcome, resultB.outcome].sort()
    expect(outcomes).toEqual(['created', 'existing'])
    expect(resultA.memberId).toBe('m-race')
    expect(resultB.memberId).toBe('m-race')
  })
})
