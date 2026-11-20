import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../../client', () => ({
  createServerSupabaseClient: vi.fn(),
}))

import { createServerSupabaseClient } from '../../client'
import {
  findRestaurantNamesByIds,
  listUserEmailsById,
  RESTAURANT_NAME_CHUNK,
} from '../admin-identity-lookups'

type Result = { data: unknown; error: { message: string } | null }

function restaurantsClient(resolve: (ids: string[]) => Result) {
  const inCalls: string[][] = []
  const from = vi.fn(() => {
    const chain: Record<string, unknown> = {}
    let ids: string[] = []
    chain.select = vi.fn(() => chain)
    chain.in = vi.fn((_col: string, vals: string[]) => {
      ids = vals
      inCalls.push(vals)
      return chain
    })
    chain.then = (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) =>
      Promise.resolve(resolve(ids)).then(ok, bad)
    return chain
  })
  vi.mocked(createServerSupabaseClient).mockReturnValue({ from } as never)
  return { from, inCalls }
}

function authClient(listUsers: ReturnType<typeof vi.fn>) {
  vi.mocked(createServerSupabaseClient).mockReturnValue({ auth: { admin: { listUsers } } } as never)
}

let warn: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  vi.clearAllMocks()
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => warn.mockRestore())

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

describe('findRestaurantNamesByIds', () => {
  it('makes no query for an empty list', async () => {
    const { from } = restaurantsClient(() => ({ data: [], error: null }))
    expect(await findRestaurantNamesByIds([])).toEqual(new Map())
    expect(from).not.toHaveBeenCalled()
  })

  it(`chunks the .in() filter at ${RESTAURANT_NAME_CHUNK} ids and merges every chunk`, async () => {
    const ids = Array.from({ length: 450 }, (_, i) => uuid(i))
    const { inCalls } = restaurantsClient((chunk) => ({
      data: chunk.map((id) => ({ id, name: `name-${id}` })),
      error: null,
    }))

    const names = await findRestaurantNamesByIds(ids)

    expect(RESTAURANT_NAME_CHUNK).toBe(200)
    expect(inCalls.map((c) => c.length)).toEqual([200, 200, 50])
    expect(names.size).toBe(450)
    expect(names.get(uuid(449))).toBe(`name-${uuid(449)}`)
  })

  it('degrades a query error to an empty map (names null), logging once, never throwing', async () => {
    const ids = Array.from({ length: 450 }, (_, i) => uuid(i))
    restaurantsClient(() => ({ data: null, error: { message: 'boom' } }))

    await expect(findRestaurantNamesByIds(ids)).resolves.toEqual(new Map())
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('degrades a thrown client error to an empty map', async () => {
    vi.mocked(createServerSupabaseClient).mockImplementation(() => {
      throw new Error('no env')
    })
    await expect(findRestaurantNamesByIds([uuid(1)])).resolves.toEqual(new Map())
    expect(warn).toHaveBeenCalledTimes(1)
  })
})

describe('listUserEmailsById', () => {
  it('lists users ONCE with perPage 1000 and maps id → email', async () => {
    const listUsers = vi.fn(async () => ({
      data: { users: [{ id: uuid(1), email: 'a@x.hk' }, { id: uuid(2), email: undefined }] },
      error: null,
    }))
    authClient(listUsers)

    const emails = await listUserEmailsById()

    expect(listUsers).toHaveBeenCalledTimes(1)
    expect(listUsers).toHaveBeenCalledWith({ perPage: 1000 })
    expect(emails).toEqual(new Map([[uuid(1), 'a@x.hk']]))
  })

  it('returns an empty map (emails null) when listUsers reports an error', async () => {
    authClient(vi.fn(async () => ({ data: { users: [] }, error: { message: 'denied' } })))
    expect(await listUserEmailsById()).toEqual(new Map())
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('returns an empty map when listUsers throws', async () => {
    authClient(vi.fn(async () => { throw new Error('network') }))
    expect(await listUserEmailsById()).toEqual(new Map())
    expect(warn).toHaveBeenCalledTimes(1)
  })
})
