import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../client', () => ({
  createServerSupabaseClient: vi.fn(),
}))

import { createServerSupabaseClient } from '../../client'
import {
  applyPartnerAssertedConsent,
  findActiveConsent,
  findActiveMarketingConsentForPhones,
  findLatestConsentByCategory,
  insertConsentRecord,
  insertConsentRecordWithOrigin,
  revokeConsent,
  upgradeToOptedIn,
  upgradeToOptedInWithOrigin,
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

  // I-3: the error message used to embed the FULL phone number
  // (`record.snapshot.phoneE164`), which flows uncaught into
  // process-member-create-job.ts's error_message/Slack/worker-log paths
  // (T-H7's "no PII in job row/Slack" invariant). Only last4 now.
  it('I-3: ConsentImportError(duplicate_active) message carries ONLY the phone\'s last 4 digits, never the full E.164 value', async () => {
    const { client } = buildInsertClient({
      code: '23505',
      message: 'duplicate key value violates unique constraint',
    })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    const record = ConsentRecord.grant({
      id: 'cr-2',
      restaurantId: 'r-1',
      memberId: null,
      phoneE164: '+85291234567',
      category: 'marketing',
      source: 'csv_import',
    })

    await expect(insertConsentRecord(record)).rejects.toMatchObject({
      message: expect.stringContaining('4567'),
    })
    await expect(insertConsentRecord(record)).rejects.not.toMatchObject({
      message: expect.stringContaining('+85291234567'),
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

describe('insertConsentRecordWithOrigin (INT-001 WI-13 Gap A)', () => {
  function buildRpcClient(
    result: { data: unknown; error: { code?: string; message: string } | null }
  ): { client: ReturnType<typeof createServerSupabaseClient>; rpc: ReturnType<typeof vi.fn> } {
    const rpc = vi.fn().mockResolvedValue(result)
    return {
      client: { rpc } as unknown as ReturnType<typeof createServerSupabaseClient>,
      rpc,
    }
  }

  beforeEach(() => vi.clearAllMocks())

  it('calls insert_consent_record_with_origin with the mapped row + origin id', async () => {
    const { client, rpc } = buildRpcClient({ data: null, error: null })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    const record = ConsentRecord.grant({
      id: 'cr-1',
      restaurantId: 'r-1',
      memberId: 'm-1',
      phoneE164: '85291234567',
      category: 'marketing',
      source: 'partner_api',
    })

    await insertConsentRecordWithOrigin(record, 'int-1')

    expect(rpc).toHaveBeenCalledWith('insert_consent_record_with_origin', {
      p_row: expect.objectContaining({ id: 'cr-1', restaurant_id: 'r-1', category: 'marketing' }),
      p_origin_integration_id: 'int-1',
    })
  })

  it('throws ConsentImportError(duplicate_active) on Postgres unique violation (23505)', async () => {
    const { client } = buildRpcClient({
      data: null,
      error: { code: '23505', message: 'duplicate key value violates unique constraint' },
    })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    const record = ConsentRecord.grant({
      id: 'cr-2',
      restaurantId: 'r-1',
      memberId: null,
      phoneE164: '85291234567',
      category: 'marketing',
      source: 'partner_api',
    })

    await expect(insertConsentRecordWithOrigin(record, 'int-1')).rejects.toBeInstanceOf(ConsentImportError)
  })

  it('I-3: ConsentImportError(duplicate_active) message carries ONLY the phone\'s last 4 digits, never the full E.164 value', async () => {
    const { client } = buildRpcClient({
      data: null,
      error: { code: '23505', message: 'duplicate key value violates unique constraint' },
    })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    const record = ConsentRecord.grant({
      id: 'cr-2',
      restaurantId: 'r-1',
      memberId: null,
      phoneE164: '+85291234567',
      category: 'marketing',
      source: 'partner_api',
    })

    await expect(insertConsentRecordWithOrigin(record, 'int-1')).rejects.toMatchObject({
      message: expect.stringContaining('4567'),
    })
    await expect(insertConsentRecordWithOrigin(record, 'int-1')).rejects.not.toMatchObject({
      message: expect.stringContaining('+85291234567'),
    })
  })

  it('throws a generic error for non-23505 database errors', async () => {
    const { client } = buildRpcClient({ data: null, error: { code: '42501', message: 'permission denied' } })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    const record = ConsentRecord.grant({
      id: 'cr-3',
      restaurantId: 'r-1',
      memberId: null,
      phoneE164: '85291234567',
      category: 'marketing',
      source: 'partner_api',
    })

    await expect(insertConsentRecordWithOrigin(record, 'int-1')).rejects.toThrow(
      /insertConsentRecordWithOrigin.*permission denied/
    )
  })
})

describe('upgradeToOptedInWithOrigin (INT-001 WI-13 Gap A)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('calls upgrade_consent_to_opted_in_with_origin and returns true when a row was upgraded', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: 1, error: null })
    vi.mocked(createServerSupabaseClient).mockReturnValue({
      rpc,
    } as unknown as ReturnType<typeof createServerSupabaseClient>)

    const result = await upgradeToOptedInWithOrigin(
      { restaurantId: 'r-1', phoneE164: '85291234567', category: 'utility' },
      'int-1'
    )

    expect(result).toBe(true)
    expect(rpc).toHaveBeenCalledWith('upgrade_consent_to_opted_in_with_origin', {
      p_restaurant_id: 'r-1',
      p_phone_e164: '85291234567',
      p_category: 'utility',
      p_origin_integration_id: 'int-1',
    })
  })

  it('returns false when no pending row matched (count 0)', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: 0, error: null })
    vi.mocked(createServerSupabaseClient).mockReturnValue({
      rpc,
    } as unknown as ReturnType<typeof createServerSupabaseClient>)

    const result = await upgradeToOptedInWithOrigin(
      { restaurantId: 'r-1', phoneE164: '85291234567', category: 'utility' },
      'int-1'
    )

    expect(result).toBe(false)
  })

  it('throws a contextual error on a database failure', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'timeout' } })
    vi.mocked(createServerSupabaseClient).mockReturnValue({
      rpc,
    } as unknown as ReturnType<typeof createServerSupabaseClient>)

    await expect(
      upgradeToOptedInWithOrigin({ restaurantId: 'r-1', phoneE164: '85291234567', category: 'utility' }, 'int-1')
    ).rejects.toThrow(/upgradeToOptedInWithOrigin.*timeout/)
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
    updateOpts?: { count: 'exact' }
    eqs: Array<{ col: string; val: unknown }>
  }

  function buildUpgradeClient(
    result: { count: number | null; error: { message: string } | null }
  ): {
    client: ReturnType<typeof createServerSupabaseClient>
    recorder: UpgradeRecorder
  } {
    const recorder: UpgradeRecorder = { update: null, eqs: [] }
    // The filter chain itself is awaited (no trailing .select) — the real
    // builder is a thenable resolving { count, error } from the update.
    // Like real PostgREST, count only comes back when the count preference
    // was sent — every test therefore enforces the { count: 'exact' } wiring.
    const eqChain = {
      eq: vi.fn(),
      then: (resolve: (v: unknown) => void) =>
        resolve({
          data: null,
          count: recorder.updateOpts?.count === 'exact' ? result.count : null,
          error: result.error,
        }),
    } as unknown as { eq: ReturnType<typeof vi.fn> }
    eqChain.eq.mockImplementation((col: string, val: unknown) => {
      recorder.eqs.push({ col, val })
      return eqChain
    })
    const update = vi
      .fn()
      .mockImplementation(
        (u: Record<string, unknown>, opts?: { count: 'exact' }) => {
          recorder.update = u
          recorder.updateOpts = opts
          return eqChain
        }
      )
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
    const { client, recorder } = buildUpgradeClient({ count: 1, error: null })
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
    // count preference must ride the UPDATE itself (a post-update .select
    // takes no options — that regression made this function always false).
    expect(recorder.updateOpts).toEqual({ count: 'exact' })
  })

  it('returns false when no pending row exists (idempotent — already opted_in)', async () => {
    const { client } = buildUpgradeClient({ count: 0, error: null })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    const upgraded = await upgradeToOptedIn({
      restaurantId: 'r-1',
      phoneE164: '85291234567',
      category: 'marketing',
    })

    expect(upgraded).toBe(false)
  })

  it('returns false when no row exists at all (no-row path)', async () => {
    const { client } = buildUpgradeClient({ count: 0, error: null })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    const upgraded = await upgradeToOptedIn({
      restaurantId: 'r-1',
      phoneE164: '85299999999',
      category: 'marketing',
    })

    expect(upgraded).toBe(false)
  })

  it('treats null count as no rows (returns false, no throw)', async () => {
    const { client } = buildUpgradeClient({ count: null, error: null })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    const upgraded = await upgradeToOptedIn({
      restaurantId: 'r-1',
      phoneE164: '85291234567',
      category: 'marketing',
    })

    expect(upgraded).toBe(false)
  })

  it('scopes the match by (restaurantId, phoneE164, category, status=pending)', async () => {
    const { client, recorder } = buildUpgradeClient({ count: 1, error: null })
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
      count: null,
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

describe('findLatestConsentByCategory (INT-001 T-C1)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('queries ALL statuses (no status filter), newest first — unlike findActiveConsent', async () => {
    const row: ConsentRecordRow = {
      id: 'cr-9',
      restaurant_id: 'r-1',
      member_id: 'm-1',
      phone_e164: '85291234567',
      category: 'marketing',
      status: 'opted_out',
      consent_grade: 'strong',
      source: 'whatsapp_stop',
      source_reference: null,
      business_name_shown: null,
      captured_at: '2026-09-01T00:00:00.000Z',
      revoked_at: '2026-09-01T00:00:00.000Z',
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

    const result = await findLatestConsentByCategory({
      restaurantId: 'r-1',
      phoneE164: '85291234567',
      category: 'marketing',
    })

    expect(result?.snapshot.status).toBe('opted_out')
    expect(recorder.ins).toEqual([]) // no `.in('status', ...)` call — sees opted_out
    expect(recorder.eqs).toEqual([
      { col: 'restaurant_id', val: 'r-1' },
      { col: 'phone_e164', val: '85291234567' },
      { col: 'category', val: 'marketing' },
    ])
    expect(recorder.orders).toEqual([
      { col: 'captured_at', opts: { ascending: false } },
    ])
  })

  it('returns null when no row exists', async () => {
    const { client } = buildSelectClient({ data: null, error: null })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    const result = await findLatestConsentByCategory({
      restaurantId: 'r-1',
      phoneE164: '85291234567',
      category: 'utility',
    })

    expect(result).toBeNull()
  })
})

describe('applyPartnerAssertedConsent (INT-001 T-C1 / OD-13 / OD-14)', () => {
  function buildLookupClient(row: ConsentRecordRow | null) {
    return buildSelectClient({ data: row, error: null }).client
  }

  // WI-13 (Gap A): applyPartnerAssertedConsent's 'inserted'/'upgraded'
  // branches now call insertConsentRecordWithOrigin / upgradeToOptedInWithOrigin,
  // which are RPCs (migration 073) instead of plain .insert()/.update() --
  // required so consent_changed_outbox can attribute the resulting
  // member.updated event to the calling integration (see that migration's
  // header for why a plain write can't do this). These recorder clients
  // capture the RPC's arguments instead of the old insert/update payload.
  function buildInsertRecorderClient(): {
    client: ReturnType<typeof createServerSupabaseClient>
    inserted: { row: Record<string, unknown> | null; originIntegrationId: unknown }
  } {
    const inserted: { row: Record<string, unknown> | null; originIntegrationId: unknown } = {
      row: null,
      originIntegrationId: undefined,
    }
    const rpc = vi.fn().mockImplementation((name: string, args: Record<string, unknown>) => {
      if (name === 'insert_consent_record_with_origin') {
        inserted.row = args.p_row as Record<string, unknown>
        inserted.originIntegrationId = args.p_origin_integration_id
      }
      return Promise.resolve({ data: null, error: null })
    })
    return {
      client: { rpc } as unknown as ReturnType<typeof createServerSupabaseClient>,
      inserted,
    }
  }

  function buildUpdateRecorderClient(count: number): {
    client: ReturnType<typeof createServerSupabaseClient>
    updated: { args: Record<string, unknown> | null }
  } {
    const updated: { args: Record<string, unknown> | null } = { args: null }
    const rpc = vi.fn().mockImplementation((name: string, args: Record<string, unknown>) => {
      if (name === 'upgrade_consent_to_opted_in_with_origin') {
        updated.args = args
      }
      return Promise.resolve({ data: count, error: null })
    })
    return {
      client: { rpc } as unknown as ReturnType<typeof createServerSupabaseClient>,
      updated,
    }
  }

  beforeEach(() => vi.clearAllMocks())

  it('opted_out latest -> blocked_opted_out, writes nothing (STOP-then-create)', async () => {
    const stopRow = {
      id: 'cr-stop',
      restaurant_id: 'r-1',
      member_id: null,
      phone_e164: '85291234567',
      category: 'marketing',
      status: 'opted_out',
      consent_grade: 'strong',
      source: 'whatsapp_stop',
      source_reference: null,
      business_name_shown: null,
      captured_at: '2026-09-01T00:00:00.000Z',
      revoked_at: '2026-09-01T00:00:00.000Z',
      captured_ip: null,
      captured_user_agent: null,
      proof_url: null,
      consent_text_shown: null,
      expires_at: null,
      granted_at: null,
      import_batch_id: null,
    } satisfies ConsentRecordRow

    // Only ONE createServerSupabaseClient() acquisition should happen (the
    // lookup) — no insert, no update. A second call returning a
    // write-capable client that gets used would be a bug this test catches
    // by never providing one.
    vi.mocked(createServerSupabaseClient).mockReturnValueOnce(
      buildLookupClient(stopRow)
    )

    const action = await applyPartnerAssertedConsent({
      restaurantId: 'r-1',
      phoneE164: '85291234567',
      memberId: 'm-1',
      category: 'marketing',
      assertedLevel: 'all',
      integrationId: 'int-1',
      grade: 'strong',
      consentText: 'I agree to marketing messages',
      businessNameShown: 'Test Restaurant',
    })

    expect(action).toBe('blocked_opted_out')
    expect(createServerSupabaseClient).toHaveBeenCalledTimes(1)
  })

  it('member deleted then re-created, latest row still opted_out -> blocked (STOP-then-delete-then-create)', async () => {
    // consent identity is (restaurant, phone) — deliberately independent of
    // member_id, which the FK sets to NULL on member delete. This test
    // asserts that a null member_id on the latest opted_out row is still
    // absorbing.
    const stopRowNoMember = {
      id: 'cr-stop-2',
      restaurant_id: 'r-1',
      member_id: null,
      phone_e164: '85291234567',
      category: 'marketing',
      status: 'opted_out',
      consent_grade: 'strong',
      source: 'whatsapp_stop',
      source_reference: null,
      business_name_shown: null,
      captured_at: '2026-09-01T00:00:00.000Z',
      revoked_at: '2026-09-01T00:00:00.000Z',
      captured_ip: null,
      captured_user_agent: null,
      proof_url: null,
      consent_text_shown: null,
      expires_at: null,
      granted_at: null,
      import_batch_id: null,
    } satisfies ConsentRecordRow

    vi.mocked(createServerSupabaseClient).mockReturnValueOnce(
      buildLookupClient(stopRowNoMember)
    )

    const action = await applyPartnerAssertedConsent({
      restaurantId: 'r-1',
      phoneE164: '85291234567',
      memberId: 'm-new-after-recreate',
      category: 'marketing',
      assertedLevel: 'all',
      integrationId: 'int-1',
      grade: 'strong',
      consentText: null,
      businessNameShown: null,
    })

    expect(action).toBe('blocked_opted_out')
    expect(createServerSupabaseClient).toHaveBeenCalledTimes(1)
  })

  it('no row + level covers category -> inserted opted_in, grade/consentText from OD-13 input', async () => {
    const { client: writeClient, inserted } = buildInsertRecorderClient()
    vi.mocked(createServerSupabaseClient)
      .mockReturnValueOnce(buildLookupClient(null))
      .mockReturnValueOnce(writeClient)

    const action = await applyPartnerAssertedConsent({
      restaurantId: 'r-1',
      phoneE164: '85291234567',
      memberId: 'm-1',
      category: 'marketing',
      assertedLevel: 'all',
      integrationId: 'int-1',
      grade: 'strong',
      consentText: 'attestation text',
      businessNameShown: 'Test Restaurant',
    })

    expect(action).toBe('inserted')
    expect(inserted.row).toMatchObject({
      status: 'opted_in',
      consent_grade: 'strong',
      source: 'partner_api',
      source_reference: 'int-1',
      consent_text_shown: 'attestation text',
      category: 'marketing',
    })
    // WI-13 (Gap A): the calling integration is passed as the origin.
    expect(inserted.originIntegrationId).toBe('int-1')
  })

  // I-3: two concurrent creates for the SAME (restaurant, phone, category)
  // both read `latest = null` and both decide 'inserted'; the loser's
  // insert hits Postgres's 23505 unique violation. That's a benign
  // outcome (the row now exists, written by the winner) -- not a real
  // failure. It used to bubble a PII-bearing ConsentImportError up through
  // process-member-create-job.ts into the job row's error_message, Slack,
  // and worker logs (T-H7 violation) AND waste a retry. Fixed: the race
  // is caught here and treated as `noop`.
  it('I-3: a 23505 on the insert (lost the create-vs-create race) is caught and treated as noop, not thrown', async () => {
    // No re-read needed inside applyPartnerAssertedConsent itself -- its
    // SOLE caller (writeConsent, process-member-create-job.ts) already
    // re-reads findLatestConsentByCategory right after this call to
    // populate `statuses[category]`, so this function only needs to stop
    // throwing and report the accurate action.
    const conflictRpc = vi.fn().mockResolvedValue({
      data: null,
      error: { code: '23505', message: 'duplicate key value violates unique constraint' },
    })
    const conflictClient = { rpc: conflictRpc } as unknown as ReturnType<typeof createServerSupabaseClient>

    vi.mocked(createServerSupabaseClient)
      .mockReturnValueOnce(buildLookupClient(null)) // initial read: no row yet
      .mockReturnValueOnce(conflictClient) // this caller's insert loses the race

    const action = await applyPartnerAssertedConsent({
      restaurantId: 'r-1',
      phoneE164: '85291234567',
      memberId: 'm-1',
      category: 'marketing',
      assertedLevel: 'all',
      integrationId: 'int-1',
      grade: 'strong',
      consentText: null,
      businessNameShown: null,
    })

    expect(action).toBe('noop')
  })

  it('no row + level does NOT cover category -> inserted pending', async () => {
    const { client: writeClient, inserted } = buildInsertRecorderClient()
    vi.mocked(createServerSupabaseClient)
      .mockReturnValueOnce(buildLookupClient(null))
      .mockReturnValueOnce(writeClient)

    const action = await applyPartnerAssertedConsent({
      restaurantId: 'r-1',
      phoneE164: '85291234567',
      memberId: 'm-1',
      category: 'marketing',
      assertedLevel: 'utility',
      integrationId: 'int-1',
      grade: 'weak',
      consentText: null,
      businessNameShown: null,
    })

    expect(action).toBe('inserted')
    expect(inserted.row).toMatchObject({ status: 'pending', source: 'partner_api' })
    expect(inserted.originIntegrationId).toBe('int-1')
  })

  it('pending + level covers -> upgraded via upgradeToOptedIn', async () => {
    const pendingRow = {
      id: 'cr-pending',
      restaurant_id: 'r-1',
      member_id: 'm-1',
      phone_e164: '85291234567',
      category: 'utility',
      status: 'pending',
      consent_grade: 'strong',
      source: 'partner_api',
      source_reference: 'int-1',
      business_name_shown: null,
      captured_at: '2026-09-01T00:00:00.000Z',
      revoked_at: null,
      captured_ip: null,
      captured_user_agent: null,
      proof_url: null,
      consent_text_shown: null,
      expires_at: null,
      granted_at: null,
      import_batch_id: null,
    } satisfies ConsentRecordRow

    const { client: writeClient, updated } = buildUpdateRecorderClient(1)
    vi.mocked(createServerSupabaseClient)
      .mockReturnValueOnce(buildLookupClient(pendingRow))
      .mockReturnValueOnce(writeClient)

    const action = await applyPartnerAssertedConsent({
      restaurantId: 'r-1',
      phoneE164: '85291234567',
      memberId: 'm-1',
      category: 'utility',
      assertedLevel: 'utility',
      integrationId: 'int-1',
      grade: 'strong',
      consentText: null,
      businessNameShown: null,
    })

    expect(action).toBe('upgraded')
    expect(updated.args).toMatchObject({
      p_restaurant_id: 'r-1',
      p_phone_e164: '85291234567',
      p_category: 'utility',
      p_origin_integration_id: 'int-1',
    })
  })

  // M-3: a STOP landing between the read (`latest` = pending) and the
  // write (the conditional `WHERE status = 'pending'` upgrade RPC) makes
  // the RPC update 0 rows -- decidePartnerConsentAction already decided
  // 'upgraded' from the STALE read, but nothing was actually upgraded.
  // The welcome path is safe regardless (it re-reads the latest status),
  // but `consent_actions` on the job row used to record an upgrade that
  // never happened.
  it('M-3: pending + level covers, but the RPC updates 0 rows (a STOP landed between read and write) -> returns noop, not upgraded', async () => {
    const pendingRow = {
      id: 'cr-pending',
      restaurant_id: 'r-1',
      member_id: 'm-1',
      phone_e164: '85291234567',
      category: 'utility',
      status: 'pending',
      consent_grade: 'strong',
      source: 'partner_api',
      source_reference: 'int-1',
      business_name_shown: null,
      captured_at: '2026-09-01T00:00:00.000Z',
      revoked_at: null,
      captured_ip: null,
      captured_user_agent: null,
      proof_url: null,
      consent_text_shown: null,
      expires_at: null,
      granted_at: null,
      import_batch_id: null,
    } satisfies ConsentRecordRow

    const { client: writeClient, updated } = buildUpdateRecorderClient(0)
    vi.mocked(createServerSupabaseClient)
      .mockReturnValueOnce(buildLookupClient(pendingRow))
      .mockReturnValueOnce(writeClient)

    const action = await applyPartnerAssertedConsent({
      restaurantId: 'r-1',
      phoneE164: '85291234567',
      memberId: 'm-1',
      category: 'utility',
      assertedLevel: 'utility',
      integrationId: 'int-1',
      grade: 'strong',
      consentText: null,
      businessNameShown: null,
    })

    expect(action).toBe('noop')
    // The RPC was still attempted (that's how we know it updated 0 rows).
    expect(updated.args).toMatchObject({ p_restaurant_id: 'r-1', p_category: 'utility' })
  })

  it('opted_in latest -> noop, writes nothing regardless of asserted level', async () => {
    const optedInRow = {
      id: 'cr-in',
      restaurant_id: 'r-1',
      member_id: 'm-1',
      phone_e164: '85291234567',
      category: 'utility',
      status: 'opted_in',
      consent_grade: 'strong',
      source: 'whatsapp_join_keyword',
      source_reference: null,
      business_name_shown: null,
      captured_at: '2026-09-01T00:00:00.000Z',
      revoked_at: null,
      captured_ip: null,
      captured_user_agent: null,
      proof_url: null,
      consent_text_shown: null,
      expires_at: null,
      granted_at: '2026-09-01T00:00:00.000Z',
      import_batch_id: null,
    } satisfies ConsentRecordRow

    vi.mocked(createServerSupabaseClient).mockReturnValueOnce(
      buildLookupClient(optedInRow)
    )

    const action = await applyPartnerAssertedConsent({
      restaurantId: 'r-1',
      phoneE164: '85291234567',
      memberId: 'm-1',
      category: 'utility',
      assertedLevel: 'none',
      integrationId: 'int-1',
      grade: 'weak',
      consentText: null,
      businessNameShown: null,
    })

    expect(action).toBe('noop')
    expect(createServerSupabaseClient).toHaveBeenCalledTimes(1)
  })
})
