import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../client', () => ({
  createServerSupabaseClient: vi.fn(),
}))

import { createServerSupabaseClient } from '../../client'
import {
  findByIdForRestaurant,
  softDelete,
  findManyByIdsForRestaurant,
} from '../whatsapp-template-repository'

const mockClient = vi.mocked(createServerSupabaseClient)

type Filter = [op: string, column: string, value: unknown]

// Records the filters applied to the query builder. Awaitable (softDelete awaits the
// builder itself) and .single()-able (findByIdForRestaurant terminates with single).
function builder(result: unknown) {
  const filters: Filter[] = []
  const chain = {
    eq: (column: string, value: unknown) => {
      filters.push(['eq', column, value])
      return chain
    },
    neq: (column: string, value: unknown) => {
      filters.push(['neq', column, value])
      return chain
    },
    in: (column: string, value: unknown) => {
      filters.push(['in', column, value])
      return chain
    },
    single: () => Promise.resolve(result),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve),
  }
  return { chain, filters }
}

const ROW = {
  id: 'tpl-1',
  restaurant_id: 'rest-1',
  meta_template_id: 'meta-1',
  name: 'welcome_msg',
  language: 'en',
  category: 'MARKETING',
  status: 'approved',
  components: [],
  parameter_format: 'NAMED',
  rejection_reason: null,
  created_at: '2025-01-01T00:00:00Z',
  updated_at: '2025-01-01T00:00:00Z',
}

beforeEach(() => vi.clearAllMocks())

describe('findByIdForRestaurant', () => {
  it('scopes the query by restaurant_id as well as id', async () => {
    const { chain, filters } = builder({ data: ROW, error: null })
    mockClient.mockReturnValue({
      from: () => ({ select: () => chain }),
    } as unknown as ReturnType<typeof createServerSupabaseClient>)

    const template = await findByIdForRestaurant('tpl-1', 'rest-1')

    expect(filters).toEqual([
      ['eq', 'id', 'tpl-1'],
      ['eq', 'restaurant_id', 'rest-1'],
      ['neq', 'status', 'deleted'],
    ])
    expect(template?.id).toBe('tpl-1')
  })

  it('returns null when the row belongs to another restaurant', async () => {
    // Postgrest answers a no-match .single() with an error, not a row.
    const { chain } = builder({ data: null, error: { message: 'no rows' } })
    mockClient.mockReturnValue({
      from: () => ({ select: () => chain }),
    } as unknown as ReturnType<typeof createServerSupabaseClient>)

    expect(await findByIdForRestaurant('tpl-of-rest-1', 'rest-2')).toBeNull()
  })
})

describe('softDelete', () => {
  it('scopes the update by restaurant_id as well as id', async () => {
    const { chain, filters } = builder({ error: null })
    const update = vi.fn(() => chain)
    mockClient.mockReturnValue({
      from: () => ({ update }),
    } as unknown as ReturnType<typeof createServerSupabaseClient>)

    await softDelete('tpl-1', 'rest-1')

    expect(update).toHaveBeenCalledWith({ status: 'deleted' })
    expect(filters).toEqual([
      ['eq', 'id', 'tpl-1'],
      ['eq', 'restaurant_id', 'rest-1'],
    ])
  })

  it('throws when the update errors', async () => {
    const { chain } = builder({ error: { message: 'boom' } })
    mockClient.mockReturnValue({
      from: () => ({ update: () => chain }),
    } as unknown as ReturnType<typeof createServerSupabaseClient>)

    await expect(softDelete('tpl-1', 'rest-1')).rejects.toThrow('softDeleteTemplate: boom')
  })
})

// #102 fix 4: batch fetch used by the campaigns API to enrich campaigns
// with template-review state — ONE query for however many distinct
// whatsappTemplateIds the campaign list references, not one per campaign
// (N+1 prevention).
describe('findManyByIdsForRestaurant', () => {
  it('scopes by restaurant_id, filters by id list, and excludes deleted', async () => {
    const { chain, filters } = builder({ data: [ROW], error: null })
    mockClient.mockReturnValue({
      from: () => ({ select: () => chain }),
    } as unknown as ReturnType<typeof createServerSupabaseClient>)

    const templates = await findManyByIdsForRestaurant(['tpl-1', 'tpl-2'], 'rest-1')

    expect(filters).toEqual([
      ['eq', 'restaurant_id', 'rest-1'],
      ['in', 'id', ['tpl-1', 'tpl-2']],
      ['neq', 'status', 'deleted'],
    ])
    expect(templates).toHaveLength(1)
    expect(templates[0].id).toBe('tpl-1')
  })

  it('returns [] without querying when ids is empty', async () => {
    const result = await findManyByIdsForRestaurant([], 'rest-1')
    expect(result).toEqual([])
    expect(mockClient).not.toHaveBeenCalled()
  })

  it('throws when the query errors', async () => {
    const { chain } = builder({ data: null, error: { message: 'boom' } })
    mockClient.mockReturnValue({
      from: () => ({ select: () => chain }),
    } as unknown as ReturnType<typeof createServerSupabaseClient>)

    await expect(findManyByIdsForRestaurant(['tpl-1'], 'rest-1')).rejects.toThrow(
      'findManyByIdsForRestaurant: boom'
    )
  })
})
