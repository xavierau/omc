import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../client', () => ({
  createServerSupabaseClient: vi.fn(),
}))

import { createServerSupabaseClient } from '../../client'
import {
  findActiveConsent,
  insertConsentRecord,
  revokeConsent,
} from '../consent-record-repository'
import { ConsentRecord } from '@/domain/entities/consent-record'
import { ConsentImportError } from '@/domain/repositories/consent-record-repository'
import type { ConsentRecordRow } from '../consent-record-mapper'

interface SelectRecorder {
  selected?: string
  eqs: Array<{ col: string; val: unknown }>
  ins?: Array<{ col: string; vals: unknown[] }>
  orders: Array<{ col: string; opts: { ascending: boolean } | undefined }>
  limited?: number
  single?: boolean
}

function buildSelectClient(
  result: { data: ConsentRecordRow | null; error: { message: string } | null }
): {
  client: ReturnType<typeof createServerSupabaseClient>
  recorder: SelectRecorder
} {
  const recorder: SelectRecorder = { eqs: [], ins: [], orders: [] }
  const maybeSingle = vi.fn().mockResolvedValue(result)
  const limit = vi.fn().mockImplementation((n: number) => {
    recorder.limited = n
    return { maybeSingle }
  })
  const order = vi.fn().mockImplementation(
    (col: string, opts: { ascending: boolean } | undefined) => {
      recorder.orders.push({ col, opts })
      return { limit, maybeSingle }
    }
  )
  const inFn = vi.fn().mockImplementation((col: string, vals: unknown[]) => {
    recorder.ins!.push({ col, vals })
    return { order, limit, maybeSingle }
  })
  const eqChain = {
    eq: vi.fn(),
    in: inFn,
    order,
    limit,
    maybeSingle,
  } as unknown as { eq: ReturnType<typeof vi.fn> }
  eqChain.eq.mockImplementation((col: string, val: unknown) => {
    recorder.eqs.push({ col, val })
    return eqChain
  })
  const select = vi.fn().mockImplementation((cols: string) => {
    recorder.selected = cols
    return eqChain
  })
  const from = vi.fn().mockReturnValue({ select })
  return {
    client: { from } as unknown as ReturnType<typeof createServerSupabaseClient>,
    recorder,
  }
}

describe('findActiveConsent', () => {
  beforeEach(() => vi.clearAllMocks())

  it('queries (restaurant_id, phone_e164, category) with status IN (opted_in, pending), newest first', async () => {
    const row: ConsentRecordRow = {
      id: 'cr-1',
      restaurant_id: 'r-1',
      member_id: 'm-1',
      phone_e164: '85291234567',
      category: 'marketing',
      status: 'opted_in',
      consent_grade: 'strong',
      source: 'website_form',
      source_reference: null,
      business_name_shown: null,
      captured_at: '2026-05-04T10:00:00.000Z',
      revoked_at: null,
      captured_ip: null,
      captured_user_agent: null,
    }
    const { client, recorder } = buildSelectClient({ data: row, error: null })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    const found = await findActiveConsent({
      restaurantId: 'r-1',
      phoneE164: '85291234567',
      category: 'marketing',
    })

    expect(found).not.toBeNull()
    expect(found!.snapshot.id).toBe('cr-1')
    expect(found!.snapshot.status).toBe('opted_in')
    expect(recorder.eqs).toEqual([
      { col: 'restaurant_id', val: 'r-1' },
      { col: 'phone_e164', val: '85291234567' },
      { col: 'category', val: 'marketing' },
    ])
    expect(recorder.ins).toEqual([
      { col: 'status', vals: ['opted_in', 'pending'] },
    ])
    // Most-recent-first ordering on captured_at — newest active row wins.
    expect(recorder.orders[0]).toEqual({
      col: 'captured_at',
      opts: { ascending: false },
    })
    expect(recorder.limited).toBe(1)
  })

  it('returns null when no row matches', async () => {
    const { client } = buildSelectClient({ data: null, error: null })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    const found = await findActiveConsent({
      restaurantId: 'r-1',
      phoneE164: '85299999999',
      category: 'marketing',
    })
    expect(found).toBeNull()
  })

  it('throws a contextual error when the database returns an error', async () => {
    const { client } = buildSelectClient({
      data: null,
      error: { message: 'connection lost' },
    })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    await expect(
      findActiveConsent({
        restaurantId: 'r-1',
        phoneE164: '85291234567',
        category: 'marketing',
      })
    ).rejects.toThrow(/findActiveConsent.*connection lost/)
  })
})

describe('insertConsentRecord', () => {
  function buildInsertClient(
    error: { code?: string; message: string } | null
  ): {
    client: ReturnType<typeof createServerSupabaseClient>
    inserted: { value: Record<string, unknown> | null }
  } {
    const inserted: { value: Record<string, unknown> | null } = { value: null }
    const insert = vi
      .fn()
      .mockImplementation((row: Record<string, unknown>) => {
        inserted.value = row
        return Promise.resolve({ data: null, error })
      })
    const from = vi.fn().mockReturnValue({ insert })
    return {
      client: { from } as unknown as ReturnType<
        typeof createServerSupabaseClient
      >,
      inserted,
    }
  }

  beforeEach(() => vi.clearAllMocks())

  it('writes the mapped row', async () => {
    const { client, inserted } = buildInsertClient(null)
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    const record = ConsentRecord.grant({
      id: 'cr-1',
      restaurantId: 'r-1',
      memberId: 'm-1',
      phoneE164: '85291234567',
      category: 'marketing',
      source: 'website_form',
    })

    await insertConsentRecord(record)

    expect(inserted.value).toMatchObject({
      id: 'cr-1',
      restaurant_id: 'r-1',
      phone_e164: '85291234567',
      category: 'marketing',
      status: 'opted_in',
      consent_grade: 'strong',
      source: 'website_form',
    })
  })

  it('throws ConsentImportError(duplicate_active) on Postgres unique violation (23505)', async () => {
    const { client } = buildInsertClient({
      code: '23505',
      message: 'duplicate key value violates unique constraint "idx_consent_active_uniq"',
    })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    const record = ConsentRecord.grant({
      id: 'cr-2',
      restaurantId: 'r-1',
      memberId: null,
      phoneE164: '85291234567',
      category: 'marketing',
      source: 'csv_import',
    })

    await expect(insertConsentRecord(record)).rejects.toBeInstanceOf(
      ConsentImportError
    )
    await expect(insertConsentRecord(record)).rejects.toMatchObject({
      reason: 'duplicate_active',
    })
  })

  it('throws a generic error for non-23505 database errors', async () => {
    const { client } = buildInsertClient({
      code: '42501',
      message: 'permission denied',
    })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    const record = ConsentRecord.grant({
      id: 'cr-3',
      restaurantId: 'r-1',
      memberId: null,
      phoneE164: '85291234567',
      category: 'marketing',
      source: 'csv_import',
    })

    await expect(insertConsentRecord(record)).rejects.toThrow(
      /insertConsentRecord.*permission denied/
    )
  })
})

describe('revokeConsent', () => {
  interface UpdateRecorder {
    update: Record<string, unknown> | null
    eqs: Array<{ col: string; val: unknown }>
    ins: Array<{ col: string; vals: unknown[] }>
    selected?: string
  }

  function buildUpdateClient(
    rows: Array<{ id: string }>,
    err: { message: string } | null = null
  ): {
    client: ReturnType<typeof createServerSupabaseClient>
    recorder: UpdateRecorder
  } {
    const recorder: UpdateRecorder = { update: null, eqs: [], ins: [] }
    const select = vi.fn().mockImplementation((cols: string) => {
      recorder.selected = cols
      return Promise.resolve({ data: rows, error: err })
    })
    const inFn = vi.fn().mockImplementation((col: string, vals: unknown[]) => {
      recorder.ins.push({ col, vals })
      return { select }
    })
    const eqChain = {
      eq: vi.fn(),
      in: inFn,
      select,
    } as unknown as { eq: ReturnType<typeof vi.fn> }
    eqChain.eq.mockImplementation((col: string, val: unknown) => {
      recorder.eqs.push({ col, val })
      return eqChain
    })
    const update = vi.fn().mockImplementation((u: Record<string, unknown>) => {
      recorder.update = u
      return eqChain
    })
    const from = vi.fn().mockReturnValue({ update })
    return {
      client: { from } as unknown as ReturnType<
        typeof createServerSupabaseClient
      >,
      recorder,
    }
  }

  beforeEach(() => vi.clearAllMocks())

  it('flips active rows to opted_out and stamps revoked_at; returns count', async () => {
    const { client, recorder } = buildUpdateClient([{ id: 'a' }, { id: 'b' }])
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    const count = await revokeConsent({
      restaurantId: 'r-1',
      phoneE164: '85291234567',
    })

    expect(count).toBe(2)
    expect(recorder.update).toMatchObject({
      status: 'opted_out',
    })
    expect(recorder.update?.revoked_at).toEqual(expect.any(String))
    // Tenant + phone scoped, then status filter via .in
    expect(recorder.eqs).toEqual([
      { col: 'restaurant_id', val: 'r-1' },
      { col: 'phone_e164', val: '85291234567' },
    ])
    expect(recorder.ins).toEqual([
      { col: 'status', vals: ['opted_in', 'pending'] },
    ])
  })

  it('narrows by category when supplied', async () => {
    const { client, recorder } = buildUpdateClient([{ id: 'a' }])
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    const count = await revokeConsent({
      restaurantId: 'r-1',
      phoneE164: '85291234567',
      category: 'marketing',
    })

    expect(count).toBe(1)
    expect(recorder.eqs).toEqual([
      { col: 'restaurant_id', val: 'r-1' },
      { col: 'phone_e164', val: '85291234567' },
      { col: 'category', val: 'marketing' },
    ])
  })

  it('returns 0 when no rows match', async () => {
    const { client } = buildUpdateClient([])
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    const count = await revokeConsent({
      restaurantId: 'r-1',
      phoneE164: '85299999999',
    })
    expect(count).toBe(0)
  })

  it('throws on database error', async () => {
    const { client } = buildUpdateClient([], { message: 'permission denied' })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    await expect(
      revokeConsent({ restaurantId: 'r-1', phoneE164: '85291234567' })
    ).rejects.toThrow(/revokeConsent.*permission denied/)
  })
})
