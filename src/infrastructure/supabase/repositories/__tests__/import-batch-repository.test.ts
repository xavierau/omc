// WONB-004: import_batch repository (sole writer, service-role client).
// The mocks below mimic the supabase-js fluent builder pattern; RLS is
// exercised by the migration itself, not these unit tests.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../client', () => ({
  createServerSupabaseClient: vi.fn(),
}))

import { createServerSupabaseClient } from '../../client'
import {
  insertImportBatch,
  findByRestaurant,
  updateImportBatchCounts,
} from '../import-batch-repository'
import { ImportBatch } from '@/domain/entities/import-batch'

type SupabaseClient = ReturnType<typeof createServerSupabaseClient>

const NOW = new Date('2026-05-04T12:00:00.000Z')

beforeEach(() => vi.clearAllMocks())

function buildEntity(): ImportBatch {
  return ImportBatch.create({
    id: '11111111-1111-1111-1111-111111111111',
    restaurantId: 'rest-1',
    source: 'paper-list-2026-Q1',
    dateRangeStart: new Date('2025-11-01T00:00:00.000Z'),
    dateRangeEnd: new Date('2026-01-31T00:00:00.000Z'),
    consentTextShown: 'I agree to receive marketing messages from Demo Cafe.',
    consentChannel: 'generic',
    proofUrl: null,
    rowCount: 10,
    strongCount: 0,
    mediumCount: 5,
    weakCount: 5,
    noneCount: 0,
    createdBy: 'auth-1',
    now: NOW,
  })
}

interface InsertRecorder {
  table: string | null
  inserted: Record<string, unknown> | null
}

function buildInsertClient(error: { message: string } | null = null): {
  client: SupabaseClient
  recorder: InsertRecorder
} {
  const recorder: InsertRecorder = { table: null, inserted: null }
  const insertFn = vi.fn().mockImplementation((row: Record<string, unknown>) => {
    recorder.inserted = row
    return Promise.resolve({ error })
  })
  const from = vi.fn().mockImplementation((t: string) => {
    recorder.table = t
    return { insert: insertFn }
  })
  return { client: { from } as unknown as SupabaseClient, recorder }
}

describe('insertImportBatch', () => {
  it('inserts a snake-case row into import_batch', async () => {
    const { client, recorder } = buildInsertClient()
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    await insertImportBatch(buildEntity())

    expect(recorder.table).toBe('import_batch')
    expect(recorder.inserted).toMatchObject({
      id: '11111111-1111-1111-1111-111111111111',
      restaurant_id: 'rest-1',
      source: 'paper-list-2026-Q1',
      consent_channel: 'generic',
      row_count: 10,
      medium_count: 5,
    })
  })

  it('throws contextually on db error', async () => {
    const { client } = buildInsertClient({ message: 'unique violation' })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    await expect(insertImportBatch(buildEntity())).rejects.toThrow(
      /insertImportBatch.*unique violation/
    )
  })
})

interface SelectRecorder {
  table: string | null
  eqs: Array<{ col: string; val: unknown }>
  orderArgs: Array<[string, unknown]>
  limitArg: number | null
}

function buildSelectClient(rows: unknown[]): {
  client: SupabaseClient
  recorder: SelectRecorder
} {
  const recorder: SelectRecorder = {
    table: null,
    eqs: [],
    orderArgs: [],
    limitArg: null,
  }
  const result = { data: rows, error: null }
  const limitFn = vi.fn().mockImplementation((n: number) => {
    recorder.limitArg = n
    return Promise.resolve(result)
  })
  const orderFn = vi.fn().mockImplementation((col: string, opts: unknown) => {
    recorder.orderArgs.push([col, opts])
    return { limit: limitFn }
  })
  const eqFn = vi.fn().mockImplementation((col: string, val: unknown) => {
    recorder.eqs.push({ col, val })
    return { order: orderFn, eq: eqFn }
  })
  const select = vi.fn().mockReturnValue({ eq: eqFn, order: orderFn, limit: limitFn })
  const from = vi.fn().mockImplementation((t: string) => {
    recorder.table = t
    return { select }
  })
  return { client: { from } as unknown as SupabaseClient, recorder }
}

interface UpdateRecorder {
  table: string | null
  updated: Record<string, unknown> | null
  eqs: Array<{ col: string; val: unknown }>
}

function buildUpdateClient(error: { message: string } | null = null): {
  client: SupabaseClient
  recorder: UpdateRecorder
} {
  const recorder: UpdateRecorder = { table: null, updated: null, eqs: [] }
  const eqFn = vi.fn().mockImplementation((col: string, val: unknown) => {
    recorder.eqs.push({ col, val })
    return Promise.resolve({ error })
  })
  const updateFn = vi.fn().mockImplementation((row: Record<string, unknown>) => {
    recorder.updated = row
    return { eq: eqFn }
  })
  const from = vi.fn().mockImplementation((t: string) => {
    recorder.table = t
    return { update: updateFn }
  })
  return { client: { from } as unknown as SupabaseClient, recorder }
}

describe('updateImportBatchCounts (B5)', () => {
  it('updates only row_count + breakdown columns on the matching id', async () => {
    const { client, recorder } = buildUpdateClient()
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    await updateImportBatchCounts('batch-1', {
      rowCount: 7,
      gradeBreakdown: { strong: 1, medium: 2, weak: 3, none: 1 },
    })

    expect(recorder.table).toBe('import_batch')
    expect(recorder.updated).toEqual({
      row_count: 7,
      strong_count: 1,
      medium_count: 2,
      weak_count: 3,
      none_count: 1,
    })
    expect(recorder.eqs).toEqual([{ col: 'id', val: 'batch-1' }])
  })

  it('throws contextually on db error', async () => {
    const { client } = buildUpdateClient({ message: 'fk violation' })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    await expect(
      updateImportBatchCounts('batch-1', {
        rowCount: 0,
        gradeBreakdown: { strong: 0, medium: 0, weak: 0, none: 0 },
      })
    ).rejects.toThrow(/updateImportBatchCounts.*fk violation/)
  })
})

describe('findByRestaurant', () => {
  it('selects from import_batch ordered by created_at DESC with limit', async () => {
    const row = {
      id: '11111111-1111-1111-1111-111111111111',
      restaurant_id: 'rest-1',
      source: 'paper-list',
      date_range_start: '2025-11-01T00:00:00.000Z',
      date_range_end: '2026-01-31T00:00:00.000Z',
      consent_text_shown: 'I agree to receive marketing.',
      consent_channel: 'generic',
      proof_url: null,
      row_count: 1,
      strong_count: 0,
      medium_count: 1,
      weak_count: 0,
      none_count: 0,
      created_by: null,
      created_at: NOW.toISOString(),
    }
    const { client, recorder } = buildSelectClient([row])
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    const result = await findByRestaurant('rest-1', 50)

    expect(recorder.table).toBe('import_batch')
    expect(recorder.eqs).toEqual([{ col: 'restaurant_id', val: 'rest-1' }])
    expect(recorder.orderArgs[0][0]).toBe('created_at')
    expect(recorder.limitArg).toBe(50)
    expect(result).toHaveLength(1)
    expect(result[0].snapshot.restaurantId).toBe('rest-1')
  })

  it('returns empty array when no rows', async () => {
    const { client } = buildSelectClient([])
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)
    expect(await findByRestaurant('rest-empty', 50)).toEqual([])
  })
})
