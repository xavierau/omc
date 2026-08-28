import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../client', () => ({
  createServerSupabaseClient: vi.fn(),
}))

import { createServerSupabaseClient } from '../../client'
import {
  insertTemplateReview,
  findActiveTemplateReviewByName,
  updateTemplateReview,
  listTemplateReviewsForRestaurant,
  listTemplateReviewsByStatus,
  findTemplateReviewById,
  findLatestTemplateReviewsByNames,
  templateReviewRepository,
} from '../template-review-repository'
import { TemplateReview } from '@/domain/entities/template-review'
import type { TemplateReviewRow } from '../template-review-mapper'

const mockClient = vi.mocked(createServerSupabaseClient)

const SAMPLE_INPUT = {
  id: 'rev-1',
  restaurantId: 'rest-1',
  templateName: 'promo_summer',
  submittedBy: 'tenant-user-1',
}

beforeEach(() => vi.clearAllMocks())

function makeReview() {
  return TemplateReview.submit(SAMPLE_INPUT)
}

function makeRow(overrides: Partial<TemplateReviewRow> = {}): TemplateReviewRow {
  return {
    id: 'rev-1',
    restaurant_id: 'rest-1',
    template_id: null,
    template_name: 'promo_summer',
    target_audience_size: null,
    target_audience_query: null,
    content_preview: null,
    status: 'pending',
    submitted_by: 'tenant-user-1',
    submitted_at: '2026-04-01T00:00:00.000Z',
    reviewed_by: null,
    reviewed_at: null,
    review_notes: null,
    ...overrides,
  }
}

describe('insertTemplateReview', () => {
  it('inserts the row and resolves on success', async () => {
    const insert = vi.fn().mockResolvedValue({ error: null })
    mockClient.mockReturnValue({
      from: () => ({ insert }),
    } as unknown as ReturnType<typeof createServerSupabaseClient>)

    await insertTemplateReview(makeReview())
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'rev-1',
        restaurant_id: 'rest-1',
        template_name: 'promo_summer',
        status: 'pending',
        submitted_by: 'tenant-user-1',
      })
    )
  })

  it('throws a friendly message on unique-index violation (23505)', async () => {
    const insert = vi
      .fn()
      .mockResolvedValue({ error: { code: '23505', message: 'dup' } })
    mockClient.mockReturnValue({
      from: () => ({ insert }),
    } as unknown as ReturnType<typeof createServerSupabaseClient>)

    await expect(insertTemplateReview(makeReview())).rejects.toThrow(
      /already exists for \(rest-1, promo_summer\)/
    )
  })

  it('propagates other supabase errors', async () => {
    const insert = vi
      .fn()
      .mockResolvedValue({ error: { message: 'connection lost' } })
    mockClient.mockReturnValue({
      from: () => ({ insert }),
    } as unknown as ReturnType<typeof createServerSupabaseClient>)

    await expect(insertTemplateReview(makeReview())).rejects.toThrow(
      /connection lost/
    )
  })
})

describe('findActiveTemplateReviewByName', () => {
  it('queries (restaurant_id, template_name) with status IN (pending, approved)', async () => {
    const row = makeRow({ status: 'approved' })
    const eqs: Array<{ col: string; val: unknown }> = []
    const ins: Array<{ col: string; vals: unknown[] }> = []
    const maybeSingle = vi.fn().mockResolvedValue({ data: row, error: null })
    const limit = vi.fn().mockReturnValue({ maybeSingle })
    const order = vi.fn().mockReturnValue({ limit })
    const inFn = vi.fn((col: string, vals: unknown[]) => {
      ins.push({ col, vals })
      return { order }
    })
    const eqChain = { eq: vi.fn(), in: inFn }
    eqChain.eq.mockImplementation((col: string, val: unknown) => {
      eqs.push({ col, val })
      return eqChain
    })
    const select = vi.fn().mockReturnValue(eqChain)
    mockClient.mockReturnValue({
      from: () => ({ select }),
    } as unknown as ReturnType<typeof createServerSupabaseClient>)

    const result = await findActiveTemplateReviewByName({
      restaurantId: 'rest-1',
      templateName: 'promo_summer',
    })

    expect(result?.snapshot.status).toBe('approved')
    expect(eqs).toEqual([
      { col: 'restaurant_id', val: 'rest-1' },
      { col: 'template_name', val: 'promo_summer' },
    ])
    expect(ins[0]?.col).toBe('status')
    expect(ins[0]?.vals).toEqual(['pending', 'approved'])
  })

  it('returns null when no row matches', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
    const limit = vi.fn().mockReturnValue({ maybeSingle })
    const order = vi.fn().mockReturnValue({ limit })
    const inFn = vi.fn().mockReturnValue({ order })
    const eq = vi.fn()
    const eqChain = { eq, in: inFn }
    eq.mockReturnValue(eqChain)
    const select = vi.fn().mockReturnValue(eqChain)
    mockClient.mockReturnValue({
      from: () => ({ select }),
    } as unknown as ReturnType<typeof createServerSupabaseClient>)

    const result = await findActiveTemplateReviewByName({
      restaurantId: 'rest-1',
      templateName: 'promo_summer',
    })
    expect(result).toBeNull()
  })

  it('throws when supabase errors', async () => {
    const maybeSingle = vi
      .fn()
      .mockResolvedValue({ data: null, error: { message: 'boom' } })
    const limit = vi.fn().mockReturnValue({ maybeSingle })
    const order = vi.fn().mockReturnValue({ limit })
    const inFn = vi.fn().mockReturnValue({ order })
    const eq = vi.fn()
    const eqChain = { eq, in: inFn }
    eq.mockReturnValue(eqChain)
    const select = vi.fn().mockReturnValue(eqChain)
    mockClient.mockReturnValue({
      from: () => ({ select }),
    } as unknown as ReturnType<typeof createServerSupabaseClient>)

    await expect(
      findActiveTemplateReviewByName({
        restaurantId: 'rest-1',
        templateName: 'promo_summer',
      })
    ).rejects.toThrow(/boom/)
  })
})

describe('updateTemplateReview', () => {
  it('updates the row by id and confirms a row was matched', async () => {
    const select = vi.fn().mockResolvedValue({ data: [{ id: 'rev-1' }], error: null })
    const eq = vi.fn().mockReturnValue({ select })
    const update = vi.fn().mockReturnValue({ eq })
    mockClient.mockReturnValue({
      from: () => ({ update }),
    } as unknown as ReturnType<typeof createServerSupabaseClient>)

    const review = makeReview().approve('admin-1', 'ok')
    await updateTemplateReview(review)

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'approved', reviewed_by: 'admin-1' })
    )
    expect(eq).toHaveBeenCalledWith('id', 'rev-1')
  })

  it('throws when no row matched the id', async () => {
    const select = vi.fn().mockResolvedValue({ data: [], error: null })
    const eq = vi.fn().mockReturnValue({ select })
    const update = vi.fn().mockReturnValue({ eq })
    mockClient.mockReturnValue({
      from: () => ({ update }),
    } as unknown as ReturnType<typeof createServerSupabaseClient>)

    await expect(updateTemplateReview(makeReview())).rejects.toThrow(
      /no row matched id=rev-1/
    )
  })
})

describe('listTemplateReviewsForRestaurant', () => {
  it('orders by submitted_at desc and optionally filters by status', async () => {
    const rows = [makeRow(), makeRow({ id: 'rev-2', status: 'approved' })]
    const order = vi.fn().mockResolvedValue({ data: rows, error: null })
    const eqStatus = vi.fn().mockReturnValue({ order })
    const eqRestaurant = vi.fn().mockReturnValue({ order, eq: eqStatus })
    const select = vi.fn().mockReturnValue({ eq: eqRestaurant })
    mockClient.mockReturnValue({
      from: () => ({ select }),
    } as unknown as ReturnType<typeof createServerSupabaseClient>)

    const out = await listTemplateReviewsForRestaurant({ restaurantId: 'rest-1' })
    expect(out.length).toBe(2)
    expect(eqRestaurant).toHaveBeenCalledWith('restaurant_id', 'rest-1')
    expect(order).toHaveBeenCalledWith('submitted_at', { ascending: false })
  })

  it('returns empty array when no rows', async () => {
    const order = vi.fn().mockResolvedValue({ data: null, error: null })
    const eq = vi.fn().mockReturnValue({ order })
    const select = vi.fn().mockReturnValue({ eq })
    mockClient.mockReturnValue({
      from: () => ({ select }),
    } as unknown as ReturnType<typeof createServerSupabaseClient>)

    const out = await listTemplateReviewsForRestaurant({ restaurantId: 'rest-1' })
    expect(out).toEqual([])
  })
})

describe('listTemplateReviewsByStatus', () => {
  it('filters by status and orders by submitted_at desc', async () => {
    const rows = [makeRow({ status: 'pending' })]
    const order = vi.fn().mockResolvedValue({ data: rows, error: null })
    const eq = vi.fn().mockReturnValue({ order })
    const select = vi.fn().mockReturnValue({ eq })
    mockClient.mockReturnValue({
      from: () => ({ select }),
    } as unknown as ReturnType<typeof createServerSupabaseClient>)

    const out = await listTemplateReviewsByStatus({ status: 'pending' })
    expect(out.length).toBe(1)
    expect(eq).toHaveBeenCalledWith('status', 'pending')
  })
})

describe('findTemplateReviewById', () => {
  it('returns the entity when found', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: makeRow(), error: null })
    const eq = vi.fn().mockReturnValue({ maybeSingle })
    const select = vi.fn().mockReturnValue({ eq })
    mockClient.mockReturnValue({
      from: () => ({ select }),
    } as unknown as ReturnType<typeof createServerSupabaseClient>)

    const review = await findTemplateReviewById('rev-1')
    expect(review?.snapshot.id).toBe('rev-1')
  })

  it('returns null when not found', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
    const eq = vi.fn().mockReturnValue({ maybeSingle })
    const select = vi.fn().mockReturnValue({ eq })
    mockClient.mockReturnValue({
      from: () => ({ select }),
    } as unknown as ReturnType<typeof createServerSupabaseClient>)

    expect(await findTemplateReviewById('nope')).toBeNull()
  })
})

// #102 fix 4: unlike findActiveTemplateReviewByName (pending/approved
// only), this returns the latest row per template name REGARDLESS of
// status — a rejected or changes-requested submission still needs to be
// visible on the campaigns API instead of reporting `status: 'none'`.
describe('findLatestTemplateReviewsByNames', () => {
  it('queries by restaurant_id + template_name IN (...), ordered submitted_at desc', async () => {
    const rows = [
      makeRow({ id: 'rev-2', template_name: 'promo_summer', status: 'rejected', submitted_at: '2026-04-02T00:00:00.000Z' }),
      makeRow({ id: 'rev-1', template_name: 'promo_summer', status: 'pending', submitted_at: '2026-04-01T00:00:00.000Z' }),
    ]
    const eqs: Array<{ col: string; val: unknown }> = []
    const ins: Array<{ col: string; vals: unknown[] }> = []
    const order = vi.fn().mockResolvedValue({ data: rows, error: null })
    const inFn = vi.fn((col: string, vals: unknown[]) => {
      ins.push({ col, vals })
      return { order }
    })
    const eqChain = { eq: vi.fn(), in: inFn }
    eqChain.eq.mockImplementation((col: string, val: unknown) => {
      eqs.push({ col, val })
      return eqChain
    })
    const select = vi.fn().mockReturnValue(eqChain)
    mockClient.mockReturnValue({
      from: () => ({ select }),
    } as unknown as ReturnType<typeof createServerSupabaseClient>)

    const out = await findLatestTemplateReviewsByNames({
      restaurantId: 'rest-1',
      templateNames: ['promo_summer'],
    })

    expect(eqs).toEqual([{ col: 'restaurant_id', val: 'rest-1' }])
    expect(ins[0]).toEqual({ col: 'template_name', vals: ['promo_summer'] })
    expect(order).toHaveBeenCalledWith('submitted_at', { ascending: false })
    // Only the LATEST row for the name survives — the rejected one, since
    // it sorts first (submitted_at desc).
    expect(out).toHaveLength(1)
    expect(out[0].snapshot.id).toBe('rev-2')
    expect(out[0].snapshot.status).toBe('rejected')
  })

  it('returns [] without querying when templateNames is empty', async () => {
    const out = await findLatestTemplateReviewsByNames({
      restaurantId: 'rest-1',
      templateNames: [],
    })
    expect(out).toEqual([])
    expect(mockClient).not.toHaveBeenCalled()
  })

  it('throws when supabase errors', async () => {
    const order = vi.fn().mockResolvedValue({ data: null, error: { message: 'boom' } })
    const inFn = vi.fn().mockReturnValue({ order })
    const eq = vi.fn().mockReturnValue({ in: inFn })
    const select = vi.fn().mockReturnValue({ eq })
    mockClient.mockReturnValue({
      from: () => ({ select }),
    } as unknown as ReturnType<typeof createServerSupabaseClient>)

    await expect(
      findLatestTemplateReviewsByNames({ restaurantId: 'rest-1', templateNames: ['x'] })
    ).rejects.toThrow(/boom/)
  })
})

describe('templateReviewRepository contract lock', () => {
  it('exports all six interface methods', () => {
    expect(typeof templateReviewRepository.insert).toBe('function')
    expect(typeof templateReviewRepository.findActiveByName).toBe('function')
    expect(typeof templateReviewRepository.update).toBe('function')
    expect(typeof templateReviewRepository.listForRestaurant).toBe('function')
    expect(typeof templateReviewRepository.listByStatus).toBe('function')
    expect(typeof templateReviewRepository.findById).toBe('function')
  })
})
