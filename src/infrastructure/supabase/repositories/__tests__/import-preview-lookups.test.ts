import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../client', () => ({
  createServerSupabaseClient: vi.fn(),
}))

import { createServerSupabaseClient } from '../../client'
import {
  findExistingMemberPhones,
  findActiveMarketingConsentPhones,
  PREVIEW_CHUNK,
} from '../import-preview-lookups'

const RESTAURANT_ID = 'rest-1'

/**
 * Recording chain that also exposes insert/update/upsert/delete/rpc as spies
 * — T-B5.6 (A19). If the preview path ever calls any of these, the assertion
 * `expect(writeSpies.<x>).not.toHaveBeenCalled()` in the zero-write describe
 * block below fails.
 */
function makeClient(rowsByTable: Record<string, unknown[]>) {
  const calls: Array<{ table: string; eqs: Array<[string, unknown]>; ins: Array<[string, unknown[]]> }> = []
  const writeSpies = {
    insert: vi.fn(),
    update: vi.fn(),
    upsert: vi.fn(),
    delete: vi.fn(),
    rpc: vi.fn(),
  }

  const from = vi.fn((table: string) => {
    const record = { table, eqs: [] as Array<[string, unknown]>, ins: [] as Array<[string, unknown[]]> }
    calls.push(record)
    const resolved = { data: rowsByTable[table] ?? [], error: null }
    const chain: Record<string, unknown> = {}
    chain.eq = vi.fn((col: string, val: unknown) => {
      record.eqs.push([col, val])
      return chain
    })
    chain.in = vi.fn((col: string, vals: unknown[]) => {
      record.ins.push([col, vals])
      return chain
    })
    chain.select = vi.fn(() => chain)
    chain.then = (onFulfilled: (v: unknown) => unknown) =>
      Promise.resolve(resolved).then(onFulfilled)
    chain.insert = writeSpies.insert
    chain.update = writeSpies.update
    chain.upsert = writeSpies.upsert
    chain.delete = writeSpies.delete
    return chain
  })

  return {
    client: { from, rpc: writeSpies.rpc } as unknown as ReturnType<typeof createServerSupabaseClient>,
    calls,
    writeSpies,
  }
}

function makeErrorClient(message: string) {
  const chain: Record<string, unknown> = {}
  chain.eq = vi.fn(() => chain)
  chain.in = vi.fn(() => chain)
  chain.select = vi.fn(() => chain)
  chain.then = (onFulfilled: (v: unknown) => unknown) =>
    Promise.resolve({ data: null, error: { message } }).then(onFulfilled)
  const from = vi.fn(() => chain)
  return { from } as unknown as ReturnType<typeof createServerSupabaseClient>
}

beforeEach(() => vi.clearAllMocks())

describe('findExistingMemberPhones', () => {
  it('scopes by restaurant_id in the query and returns members.phone as a set', async () => {
    const { client, calls } = makeClient({ members: [{ phone: '+85291234567' }] })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    const result = await findExistingMemberPhones(RESTAURANT_ID, ['+85291234567', '+85299999999'])

    expect(result).toEqual(new Set(['+85291234567']))
    expect(calls[0].table).toBe('members')
    expect(calls[0].eqs).toContainEqual(['restaurant_id', RESTAURANT_ID])
    expect(calls[0].ins).toContainEqual(['phone', ['+85291234567', '+85299999999']])
  })

  it('returns an empty set for an empty phones array without querying', async () => {
    const { client, calls } = makeClient({})
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    const result = await findExistingMemberPhones(RESTAURANT_ID, [])

    expect(result).toEqual(new Set())
    expect(calls).toHaveLength(0)
  })

  it('chunks >1000 phones into multiple .in() calls and unions the results (T-B5.4)', async () => {
    const phones = Array.from({ length: 1100 }, (_, i) => `+852${String(i).padStart(8, '0')}`)
    const { client, calls } = makeClient({
      members: [{ phone: phones[0] }, { phone: phones[600] }, { phone: phones[1099] }],
    })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    const result = await findExistingMemberPhones(RESTAURANT_ID, phones)

    expect(calls).toHaveLength(3)
    calls.forEach((c) => expect(c.ins[0][1].length).toBeLessThanOrEqual(PREVIEW_CHUNK))
    expect(result).toEqual(new Set([phones[0], phones[600], phones[1099]]))
  })

  it('throws a contextual error when supabase reports an error', async () => {
    vi.mocked(createServerSupabaseClient).mockReturnValue(makeErrorClient('connection lost'))
    await expect(
      findExistingMemberPhones(RESTAURANT_ID, ['+85291234567'])
    ).rejects.toThrow(/connection lost/)
  })
})

describe('findActiveMarketingConsentPhones', () => {
  it('scopes by restaurant_id + category=marketing + status IN (opted_in, pending)', async () => {
    const { client, calls } = makeClient({
      consent_records: [{ phone_e164: '+85291234567' }],
    })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    const result = await findActiveMarketingConsentPhones(RESTAURANT_ID, ['+85291234567'])

    expect(result).toEqual(new Set(['+85291234567']))
    expect(calls[0].table).toBe('consent_records')
    expect(calls[0].eqs).toContainEqual(['restaurant_id', RESTAURANT_ID])
    expect(calls[0].eqs).toContainEqual(['category', 'marketing'])
    expect(calls[0].ins).toContainEqual(['status', ['opted_in', 'pending']])
    expect(calls[0].ins).toContainEqual(['phone_e164', ['+85291234567']])
  })

  it('returns an empty set for an empty phones array without querying', async () => {
    const { client, calls } = makeClient({})
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    const result = await findActiveMarketingConsentPhones(RESTAURANT_ID, [])

    expect(result).toEqual(new Set())
    expect(calls).toHaveLength(0)
  })

  it('chunks >1000 phones into multiple .in() calls and unions the results (T-B5.4)', async () => {
    const phones = Array.from({ length: 1100 }, (_, i) => `+852${String(i).padStart(8, '0')}`)
    const { client, calls } = makeClient({
      consent_records: [{ phone_e164: phones[1000] }],
    })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    const result = await findActiveMarketingConsentPhones(RESTAURANT_ID, phones)

    expect(calls).toHaveLength(3)
    expect(result).toEqual(new Set([phones[1000]]))
  })

  it('throws a contextual error when supabase reports an error', async () => {
    vi.mocked(createServerSupabaseClient).mockReturnValue(makeErrorClient('db down'))
    await expect(
      findActiveMarketingConsentPhones(RESTAURANT_ID, ['+85291234567'])
    ).rejects.toThrow(/db down/)
  })
})

describe('zero-write assertion (T-B5.6, A19)', () => {
  it('never calls insert/update/upsert/delete/rpc for either lookup', async () => {
    const { client, writeSpies } = makeClient({
      members: [{ phone: '+85291234567' }],
      consent_records: [{ phone_e164: '+85291234567' }],
    })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    await findExistingMemberPhones(RESTAURANT_ID, ['+85291234567'])
    await findActiveMarketingConsentPhones(RESTAURANT_ID, ['+85291234567'])

    expect(writeSpies.insert).not.toHaveBeenCalled()
    expect(writeSpies.update).not.toHaveBeenCalled()
    expect(writeSpies.upsert).not.toHaveBeenCalled()
    expect(writeSpies.delete).not.toHaveBeenCalled()
    expect(writeSpies.rpc).not.toHaveBeenCalled()
  })
})
