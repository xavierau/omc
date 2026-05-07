import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../client', () => ({
  createServerSupabaseClient: vi.fn(),
}))

import { createServerSupabaseClient } from '../../client'
import {
  findActiveConsent,
  findActiveMarketingConsentForPhones,
  insertConsentRecord,
  revokeConsent,
  upgradeToOptedIn,
  countByGradeStatus,
  upgradeGradeToStrong,
  findReconfirmationAudience,
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
      proof_url: null,
      consent_text_shown: null,
      expires_at: null,
      granted_at: null,
      import_batch_id: null,
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

describe('findActiveMarketingConsentForPhones (bulk)', () => {
  interface BulkRecorder {
    selected?: string
    eqs: Array<{ col: string; val: unknown }>
    ins: Array<{ col: string; vals: unknown[] }>
  }

  function buildBulkClient(
    rows: ConsentRecordRow[],
    err: { message: string } | null = null
  ): {
    client: ReturnType<typeof createServerSupabaseClient>
    recorder: BulkRecorder
    fromCalls: { count: number }
  } {
    const recorder: BulkRecorder = { eqs: [], ins: [] }
    const fromCalls = { count: 0 }
    // Final awaited shape: a thenable returning { data, error }.
    const finalResult = Promise.resolve({ data: rows, error: err })
    const inFn = vi.fn().mockImplementation((col: string, vals: unknown[]) => {
      recorder.ins.push({ col, vals })
      // The repo issues two .in() calls (status + phone_e164). The last one
      // resolves the query; earlier ones return the same chain.
      const chain = {
        in: vi.fn().mockImplementation((c: string, v: unknown[]) => {
          recorder.ins.push({ col: c, vals: v })
          return finalResult
        }),
      }
      return chain
    })
    const eqChain = {
      eq: vi.fn(),
      in: inFn,
    } as unknown as { eq: ReturnType<typeof vi.fn> }
    eqChain.eq.mockImplementation((col: string, val: unknown) => {
      recorder.eqs.push({ col, val })
      return eqChain
    })
    const select = vi.fn().mockImplementation((cols: string) => {
      recorder.selected = cols
      return eqChain
    })
    const from = vi.fn().mockImplementation(() => {
      fromCalls.count += 1
      return { select }
    })
    return {
      client: { from } as unknown as ReturnType<typeof createServerSupabaseClient>,
      recorder,
      fromCalls,
    }
  }

  beforeEach(() => vi.clearAllMocks())

  it('returns an empty map and does NOT hit the database when phones is empty', async () => {
    const { client, fromCalls } = buildBulkClient([])
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    const map = await findActiveMarketingConsentForPhones({
      restaurantId: 'r-1',
      phones: [],
    })

    expect(map.size).toBe(0)
    // Crucially, no round-trip when there's nothing to look up.
    expect(fromCalls.count).toBe(0)
  })

  it('issues a single SELECT … IN (phones) for the whole batch and keys the map by phone', async () => {
    const rows: ConsentRecordRow[] = [
      {
        id: 'cr-a',
        restaurant_id: 'r-1',
        member_id: 'm-a',
        phone_e164: '85291111111',
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
        proof_url: null,
        consent_text_shown: null,
        expires_at: null,
        granted_at: null,
        import_batch_id: null,
      },
      {
        id: 'cr-b',
        restaurant_id: 'r-1',
        member_id: 'm-b',
        phone_e164: '85293333333',
        category: 'marketing',
        status: 'opted_in',
        consent_grade: 'weak',
        source: 'pre-system migration',
        source_reference: null,
        business_name_shown: null,
        captured_at: '2026-05-04T11:00:00.000Z',
        revoked_at: null,
        captured_ip: null,
        captured_user_agent: null,
        proof_url: null,
        consent_text_shown: null,
        expires_at: null,
        granted_at: null,
        import_batch_id: null,
      },
    ]
    const { client, recorder, fromCalls } = buildBulkClient(rows)
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    const map = await findActiveMarketingConsentForPhones({
      restaurantId: 'r-1',
      phones: ['85291111111', '85292222222', '85293333333'],
    })

    // ONE round-trip — the whole point of this function (kills N+1).
    expect(fromCalls.count).toBe(1)
    expect(recorder.eqs).toEqual([
      { col: 'restaurant_id', val: 'r-1' },
      { col: 'category', val: 'marketing' },
    ])
    // status filter + phones IN filter
    expect(recorder.ins).toEqual(
      expect.arrayContaining([
        { col: 'status', vals: ['opted_in', 'pending'] },
        {
          col: 'phone_e164',
          vals: ['85291111111', '85292222222', '85293333333'],
        },
      ])
    )

    // Map only contains the phones with rows; the missing one is absent.
    expect(map.size).toBe(2)
    expect(map.get('85291111111')?.snapshot.id).toBe('cr-a')
    expect(map.get('85293333333')?.snapshot.id).toBe('cr-b')
    expect(map.has('85292222222')).toBe(false)
  })

  it('throws a contextual error when the database returns an error', async () => {
    const { client } = buildBulkClient([], { message: 'connection lost' })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    await expect(
      findActiveMarketingConsentForPhones({
        restaurantId: 'r-1',
        phones: ['85291234567'],
      })
    ).rejects.toThrow(/findActiveMarketingConsentForPhones.*connection lost/)
  })
})

describe('upgradeToOptedIn (WONB-005)', () => {
  interface UpgradeRecorder {
    update: Record<string, unknown> | null
    eqs: Array<{ col: string; val: unknown }>
    selectArg?: { cols: string }
  }

  function buildUpgradeClient(
    result: { data: Array<{ id: string }> | null; error: { message: string } | null }
  ): {
    client: ReturnType<typeof createServerSupabaseClient>
    recorder: UpgradeRecorder
  } {
    const recorder: UpgradeRecorder = { update: null, eqs: [] }
    const select = vi
      .fn()
      .mockImplementation(
        (cols: string) => {
          recorder.selectArg = { cols }
          return Promise.resolve({
            data: result.data,
            error: result.error,
          })
        }
      )
    const eqChain = {
      eq: vi.fn(),
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

  it('upgrades a pending row to opted_in and returns true', async () => {
    const { client, recorder } = buildUpgradeClient({ data: [{ id: 'cr-1' }], error: null })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    const upgraded = await upgradeToOptedIn({
      restaurantId: 'r-1',
      phoneE164: '85291234567',
      category: 'marketing',
    })

    expect(upgraded).toBe(true)
    // The UPDATE must set BOTH status AND granted_at — analytics (WONB-007/008)
    // depends on the explicit grant moment, not on updated_at which any touch
    // would rewrite.
    expect(recorder.update).toMatchObject({ status: 'opted_in' })
    expect(recorder.update?.granted_at).toEqual(expect.any(String))
    // ISO-8601 sanity: parseable as a Date.
    expect(
      Number.isFinite(new Date(recorder.update!.granted_at as string).getTime())
    ).toBe(true)
    expect(recorder.eqs).toEqual([
      { col: 'restaurant_id', val: 'r-1' },
      { col: 'phone_e164', val: '85291234567' },
      { col: 'category', val: 'marketing' },
      { col: 'status', val: 'pending' },
    ])
    expect(recorder.selectArg?.cols).toBe('id')
  })

  it('returns false when no pending row exists (idempotent — already opted_in)', async () => {
    const { client } = buildUpgradeClient({ data: [], error: null })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    const upgraded = await upgradeToOptedIn({
      restaurantId: 'r-1',
      phoneE164: '85291234567',
      category: 'marketing',
    })

    expect(upgraded).toBe(false)
  })

  it('returns false when no row exists at all (no-row path)', async () => {
    const { client } = buildUpgradeClient({ data: [], error: null })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    const upgraded = await upgradeToOptedIn({
      restaurantId: 'r-1',
      phoneE164: '85299999999',
      category: 'marketing',
    })

    expect(upgraded).toBe(false)
  })

  it('treats null data as no rows (returns false, no throw)', async () => {
    const { client } = buildUpgradeClient({ data: null, error: null })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    const upgraded = await upgradeToOptedIn({
      restaurantId: 'r-1',
      phoneE164: '85291234567',
      category: 'marketing',
    })

    expect(upgraded).toBe(false)
  })

  it('scopes the match by (restaurantId, phoneE164, category, status=pending)', async () => {
    const { client, recorder } = buildUpgradeClient({ data: [{ id: 'cr-1' }], error: null })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    await upgradeToOptedIn({
      restaurantId: 'r-2',
      phoneE164: '85298765432',
      category: 'utility',
    })

    expect(recorder.eqs).toEqual([
      { col: 'restaurant_id', val: 'r-2' },
      { col: 'phone_e164', val: '85298765432' },
      { col: 'category', val: 'utility' },
      { col: 'status', val: 'pending' },
    ])
  })

  it('throws a contextual error when the database returns an error', async () => {
    const { client } = buildUpgradeClient({
      data: null,
      error: { message: 'connection lost' },
    })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    await expect(
      upgradeToOptedIn({
        restaurantId: 'r-1',
        phoneE164: '85291234567',
        category: 'marketing',
      })
    ).rejects.toThrow(/upgradeToOptedIn.*connection lost/)
  })
})

describe('countByGradeStatus (WONB-008)', () => {
  interface CountRecorder {
    table: string | null
    selected?: { cols: string; opts: { count: 'exact'; head: true } | undefined }
    eqs: Array<{ col: string; val: unknown }>
  }

  function buildCountClient(result: {
    count: number | null
    error: { message: string } | null
  }): {
    client: ReturnType<typeof createServerSupabaseClient>
    recorder: CountRecorder
  } {
    const recorder: CountRecorder = { table: null, eqs: [] }
    // Final eq() resolves the query (PostgREST returns count without an
    // explicit terminal). Each .eq() returns the same chain — the LAST one
    // is the one we await. We model that by making the chain itself a
    // thenable-like object that returns the result when awaited.
    const finalResult = Promise.resolve({
      data: null,
      count: result.count,
      error: result.error,
    })
    const eqChain = {
      eq: vi.fn(),
      then: (
        onFulfilled: (v: unknown) => unknown,
        onRejected?: (e: unknown) => unknown
      ) => finalResult.then(onFulfilled, onRejected),
    } as unknown as { eq: ReturnType<typeof vi.fn> }
    eqChain.eq.mockImplementation((col: string, val: unknown) => {
      recorder.eqs.push({ col, val })
      return eqChain
    })
    const select = vi.fn().mockImplementation(
      (cols: string, opts: { count: 'exact'; head: true } | undefined) => {
        recorder.selected = { cols, opts }
        return eqChain
      }
    )
    const from = vi.fn().mockImplementation((t: string) => {
      recorder.table = t
      return { select }
    })
    return {
      client: { from } as unknown as ReturnType<typeof createServerSupabaseClient>,
      recorder,
    }
  }

  beforeEach(() => vi.clearAllMocks())

  it('issues a single SELECT count(*) scoped by (restaurant_id, category, status, consent_grade)', async () => {
    const { client, recorder } = buildCountClient({ count: 7, error: null })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    const n = await countByGradeStatus({
      restaurantId: 'r-1',
      grade: 'weak',
      status: 'opted_in',
      category: 'marketing',
    })

    expect(n).toBe(7)
    expect(recorder.table).toBe('consent_records')
    // head:true keeps the response a count-only — no rows shipped over the wire.
    expect(recorder.selected?.opts).toEqual({ count: 'exact', head: true })
    expect(recorder.eqs).toEqual([
      { col: 'restaurant_id', val: 'r-1' },
      { col: 'category', val: 'marketing' },
      { col: 'status', val: 'opted_in' },
      { col: 'consent_grade', val: 'weak' },
    ])
  })

  it('returns 0 when no rows match (null-count → 0 normalisation)', async () => {
    const { client } = buildCountClient({ count: null, error: null })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    const n = await countByGradeStatus({
      restaurantId: 'r-1',
      grade: 'weak',
      status: 'opted_in',
      category: 'marketing',
    })

    expect(n).toBe(0)
  })

  it('throws contextually on database error', async () => {
    const { client } = buildCountClient({
      count: null,
      error: { message: 'permission denied' },
    })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    await expect(
      countByGradeStatus({
        restaurantId: 'r-1',
        grade: 'weak',
        status: 'opted_in',
        category: 'marketing',
      })
    ).rejects.toThrow(/countByGradeStatus.*permission denied/)
  })
})

describe('upgradeGradeToStrong (WONB-008)', () => {
  interface UpgradeRecorder {
    update: Record<string, unknown> | null
    eqs: Array<{ col: string; val: unknown }>
    selectArg?: { cols: string }
  }

  function buildUpgradeClient(result: {
    data: Array<{ id: string }> | null
    error: { message: string } | null
  }): {
    client: ReturnType<typeof createServerSupabaseClient>
    recorder: UpgradeRecorder
  } {
    const recorder: UpgradeRecorder = { update: null, eqs: [] }
    const select = vi
      .fn()
      .mockImplementation(
        (cols: string) => {
          recorder.selectArg = { cols }
          return Promise.resolve({
            data: result.data,
            error: result.error,
          })
        }
      )
    const eqChain = {
      eq: vi.fn(),
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
      client: { from } as unknown as ReturnType<typeof createServerSupabaseClient>,
      recorder,
    }
  }

  beforeEach(() => vi.clearAllMocks())

  it('upgrades a weak+opted_in row to strong and stamps granted_at; returns true', async () => {
    const { client, recorder } = buildUpgradeClient({ data: [{ id: 'cr-1' }], error: null })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    const upgraded = await upgradeGradeToStrong({
      restaurantId: 'r-1',
      phoneE164: '85291234567',
      category: 'marketing',
    })

    expect(upgraded).toBe(true)
    // The UPDATE must set BOTH consent_grade AND granted_at — analytics
    // (events.consent_granted source='reconfirmation_campaign') depends on
    // the explicit grant moment, not on updated_at which any touch rewrites.
    expect(recorder.update).toMatchObject({ consent_grade: 'strong' })
    expect(recorder.update?.granted_at).toEqual(expect.any(String))
    expect(
      Number.isFinite(new Date(recorder.update!.granted_at as string).getTime())
    ).toBe(true)
    // WHERE: restaurant_id, phone_e164, category, status='opted_in', consent_grade='weak'
    expect(recorder.eqs).toEqual([
      { col: 'restaurant_id', val: 'r-1' },
      { col: 'phone_e164', val: '85291234567' },
      { col: 'category', val: 'marketing' },
      { col: 'status', val: 'opted_in' },
      { col: 'consent_grade', val: 'weak' },
    ])
    expect(recorder.selectArg?.cols).toBe('id')
  })

  it('returns false when no weak+opted_in row exists (idempotent — already strong)', async () => {
    const { client } = buildUpgradeClient({ data: [], error: null })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    const upgraded = await upgradeGradeToStrong({
      restaurantId: 'r-1',
      phoneE164: '85291234567',
      category: 'marketing',
    })

    expect(upgraded).toBe(false)
  })

  it('returns false when no row exists at all (no-row path, no throw)', async () => {
    const { client } = buildUpgradeClient({ data: [], error: null })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    const upgraded = await upgradeGradeToStrong({
      restaurantId: 'r-1',
      phoneE164: '85299999999',
      category: 'marketing',
    })

    expect(upgraded).toBe(false)
  })

  it('treats null data as no rows (returns false)', async () => {
    const { client } = buildUpgradeClient({ data: null, error: null })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    const upgraded = await upgradeGradeToStrong({
      restaurantId: 'r-1',
      phoneE164: '85291234567',
      category: 'marketing',
    })

    expect(upgraded).toBe(false)
  })

  it('respects the category scope (utility category does not match marketing rows)', async () => {
    const { client, recorder } = buildUpgradeClient({ data: [], error: null })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    await upgradeGradeToStrong({
      restaurantId: 'r-2',
      phoneE164: '85298765432',
      category: 'utility',
    })

    expect(recorder.eqs).toEqual([
      { col: 'restaurant_id', val: 'r-2' },
      { col: 'phone_e164', val: '85298765432' },
      { col: 'category', val: 'utility' },
      { col: 'status', val: 'opted_in' },
      { col: 'consent_grade', val: 'weak' },
    ])
  })

  it('throws contextually on database error', async () => {
    const { client } = buildUpgradeClient({
      data: null,
      error: { message: 'connection lost' },
    })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    await expect(
      upgradeGradeToStrong({
        restaurantId: 'r-1',
        phoneE164: '85291234567',
        category: 'marketing',
      })
    ).rejects.toThrow(/upgradeGradeToStrong.*connection lost/)
  })
})

describe('findReconfirmationAudience (WONB-008)', () => {
  // Returns members whose consent is `grade='weak' AND status='opted_in' AND
  // category='marketing'`, sorted by captured_at DESC, capped to `limit`.
  // The query embeds members via a PostgREST inner join on the FK.

  interface Recorder {
    table: string | null
    selected?: string
    eqs: Array<{ col: string; val: unknown }>
    orders: Array<{ col: string; opts: { ascending: boolean } | undefined }>
    limited?: number
  }

  function buildClient(rows: Array<Record<string, unknown>>, error: { message: string } | null = null) {
    const recorder: Recorder = { table: null, eqs: [], orders: [] }
    const limit = vi.fn().mockImplementation((n: number) => {
      recorder.limited = n
      return Promise.resolve({ data: rows, error })
    })
    const order = vi.fn().mockImplementation((col: string, opts) => {
      recorder.orders.push({ col, opts })
      return { order, limit }
    })
    const eq = vi.fn().mockImplementation((col: string, val: unknown) => {
      recorder.eqs.push({ col, val })
      return { eq, order, limit }
    })
    const select = vi.fn().mockImplementation((cols: string) => {
      recorder.selected = cols
      return { eq, order, limit }
    })
    const from = vi.fn().mockImplementation((t: string) => {
      recorder.table = t
      return { select }
    })
    return {
      client: { from } as unknown as ReturnType<typeof createServerSupabaseClient>,
      recorder,
    }
  }

  beforeEach(() => vi.clearAllMocks())

  it('queries consent_records joined to members and filters weak+opted_in+marketing', async () => {
    const { client, recorder } = buildClient([
      {
        captured_at: '2026-04-01T00:00:00Z',
        members: { id: 'm-1', phone_e164: '85291111111', preferred_language: 'en' },
      },
    ])
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    await findReconfirmationAudience({ restaurantId: 'r-1', limit: 50 })

    expect(recorder.table).toBe('consent_records')
    expect(recorder.eqs).toEqual([
      { col: 'restaurant_id', val: 'r-1' },
      { col: 'category', val: 'marketing' },
      { col: 'status', val: 'opted_in' },
      { col: 'consent_grade', val: 'weak' },
    ])
    expect(recorder.orders[0]).toEqual({
      col: 'captured_at',
      opts: { ascending: false },
    })
    expect(recorder.limited).toBe(50)
  })

  it('maps each row to { memberId, phoneE164, preferredLanguage }', async () => {
    const { client } = buildClient([
      {
        captured_at: '2026-04-01T00:00:00Z',
        members: {
          id: 'm-1',
          phone_e164: '85291111111',
          preferred_language: 'en',
        },
      },
      {
        captured_at: '2026-03-01T00:00:00Z',
        members: {
          id: 'm-2',
          phone_e164: '85292222222',
          preferred_language: null,
        },
      },
    ])
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    const out = await findReconfirmationAudience({
      restaurantId: 'r-1',
      limit: 10,
    })

    expect(out).toEqual([
      { memberId: 'm-1', phoneE164: '85291111111', preferredLanguage: 'en' },
      { memberId: 'm-2', phoneE164: '85292222222', preferredLanguage: null },
    ])
  })

  it('skips rows whose member embed is null (defensive — orphaned consent rows)', async () => {
    const { client } = buildClient([
      { captured_at: '2026-04-01T00:00:00Z', members: null },
      {
        captured_at: '2026-03-01T00:00:00Z',
        members: {
          id: 'm-2',
          phone_e164: '85292222222',
          preferred_language: 'zh_hk',
        },
      },
    ])
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    const out = await findReconfirmationAudience({
      restaurantId: 'r-1',
      limit: 10,
    })

    expect(out).toEqual([
      { memberId: 'm-2', phoneE164: '85292222222', preferredLanguage: 'zh_hk' },
    ])
  })

  it('throws contextually on db error', async () => {
    const { client } = buildClient([], { message: 'permission denied' })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    await expect(
      findReconfirmationAudience({ restaurantId: 'r-1', limit: 50 })
    ).rejects.toThrow(/findReconfirmationAudience.*permission denied/)
  })
})
