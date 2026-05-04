import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../client', () => ({
  createServerSupabaseClient: vi.fn(),
}))

import { createServerSupabaseClient } from '../../client'
import {
  findOpenWindow,
  upsertOpenWindow,
  isWindowOpen,
  bulkIsWindowOpen,
  conversationWindowRepository,
} from '../conversation-window-repository'
import { ConversationWindow } from '@/domain/entities/conversation-window'

interface SelectRecorder {
  table: string | null
  eqs: Array<{ col: string; val: unknown }>
  ins: Array<{ col: string; vals: unknown[] }>
  gts: Array<{ col: string; val: unknown }>
  orders: Array<{ column: string; ascending: boolean }>
  limit: number | null
}

function buildSelectClient(result: {
  data: unknown
  error: { message: string } | null
}): {
  client: ReturnType<typeof createServerSupabaseClient>
  recorder: SelectRecorder
} {
  const recorder: SelectRecorder = {
    table: null,
    eqs: [],
    ins: [],
    gts: [],
    orders: [],
    limit: null,
  }
  const maybeSingle = vi.fn().mockResolvedValue(result)
  // The chain after .select() exposes .eq().eq().gt().order().limit().maybeSingle()
  // OR .eq().eq().in() (for bulk). Build a flexible chain object.
  const chain: Record<string, unknown> = {}
  chain.eq = vi.fn().mockImplementation((col: string, val: unknown) => {
    recorder.eqs.push({ col, val })
    return chain
  })
  chain.gt = vi.fn().mockImplementation((col: string, val: unknown) => {
    recorder.gts.push({ col, val })
    return chain
  })
  chain.in = vi.fn().mockImplementation((col: string, vals: unknown[]) => {
    recorder.ins.push({ col, vals })
    return Promise.resolve(result)
  })
  chain.order = vi
    .fn()
    .mockImplementation((column: string, opts: { ascending: boolean }) => {
      recorder.orders.push({ column, ascending: opts.ascending })
      return chain
    })
  chain.limit = vi.fn().mockImplementation((n: number) => {
    recorder.limit = n
    return { maybeSingle }
  })
  const select = vi.fn().mockReturnValue(chain)
  const from = vi.fn().mockImplementation((t: string) => {
    recorder.table = t
    return { select }
  })
  return {
    client: { from } as unknown as ReturnType<typeof createServerSupabaseClient>,
    recorder,
  }
}

interface InsertRecorder {
  table: string | null
  inserted: Record<string, unknown> | null
}

function buildInsertClient(opts: {
  error: { message: string } | null
} = { error: null }): {
  client: ReturnType<typeof createServerSupabaseClient>
  recorder: InsertRecorder
} {
  const recorder: InsertRecorder = { table: null, inserted: null }
  const insert = vi.fn().mockImplementation((row: Record<string, unknown>) => {
    recorder.inserted = row
    return Promise.resolve({ error: opts.error })
  })
  const from = vi.fn().mockImplementation((t: string) => {
    recorder.table = t
    return { insert }
  })
  return {
    client: { from } as unknown as ReturnType<typeof createServerSupabaseClient>,
    recorder,
  }
}

interface CompositeRecorder {
  selectRecorder: SelectRecorder
  insertRecorder: InsertRecorder
  updateCalls: Array<{ patch: Record<string, unknown>; eqs: Array<{ col: string; val: unknown }> }>
}

/**
 * For upsertOpenWindow we need a client that can both SELECT (to find an
 * existing open row) and either UPDATE the existing row or INSERT a new
 * one. Two separate chains keyed off the call order.
 */
function buildUpsertClient(args: {
  existing: Record<string, unknown> | null
  insertError?: { message: string } | null
  updateError?: { message: string } | null
}): {
  client: ReturnType<typeof createServerSupabaseClient>
  recorder: CompositeRecorder
} {
  const selectRecorder: SelectRecorder = {
    table: null,
    eqs: [],
    ins: [],
    gts: [],
    orders: [],
    limit: null,
  }
  const insertRecorder: InsertRecorder = { table: null, inserted: null }
  const updateCalls: Array<{
    patch: Record<string, unknown>
    eqs: Array<{ col: string; val: unknown }>
  }> = []

  const selectMaybeSingle = vi.fn().mockResolvedValue({
    data: args.existing,
    error: null,
  })
  const selectChain: Record<string, unknown> = {}
  selectChain.eq = vi.fn().mockImplementation((col: string, val: unknown) => {
    selectRecorder.eqs.push({ col, val })
    return selectChain
  })
  selectChain.gt = vi.fn().mockImplementation((col: string, val: unknown) => {
    selectRecorder.gts.push({ col, val })
    return selectChain
  })
  selectChain.order = vi
    .fn()
    .mockImplementation((column: string, opts: { ascending: boolean }) => {
      selectRecorder.orders.push({ column, ascending: opts.ascending })
      return selectChain
    })
  selectChain.limit = vi.fn().mockImplementation((n: number) => {
    selectRecorder.limit = n
    return { maybeSingle: selectMaybeSingle }
  })

  function buildUpdateChain(patch: Record<string, unknown>) {
    const localEqs: Array<{ col: string; val: unknown }> = []
    const node: Record<string, unknown> = {}
    node.eq = vi.fn().mockImplementation((col: string, val: unknown) => {
      localEqs.push({ col, val })
      // Resolve when the chain ends — we use a thenable.
      return node
    })
    node.then = (
      onFulfilled: (v: { error: unknown }) => unknown,
      onRejected?: (e: unknown) => unknown
    ) => {
      updateCalls.push({ patch, eqs: localEqs })
      return Promise.resolve({ error: args.updateError ?? null }).then(
        onFulfilled,
        onRejected
      )
    }
    return node
  }

  const from = vi.fn().mockImplementation((t: string) => {
    selectRecorder.table = t
    insertRecorder.table = t
    return {
      select: vi.fn().mockReturnValue(selectChain),
      insert: vi.fn().mockImplementation((row: Record<string, unknown>) => {
        insertRecorder.inserted = row
        return Promise.resolve({ error: args.insertError ?? null })
      }),
      update: vi.fn().mockImplementation((patch: Record<string, unknown>) =>
        buildUpdateChain(patch)
      ),
    }
  })

  return {
    client: { from } as unknown as ReturnType<typeof createServerSupabaseClient>,
    recorder: { selectRecorder, insertRecorder, updateCalls },
  }
}

describe('findOpenWindow', () => {
  beforeEach(() => vi.clearAllMocks())

  it('queries by restaurant + phone, filters expires_at > at, orders DESC, limits 1', async () => {
    const at = new Date('2026-05-04T10:00:00.000Z')
    const { client, recorder } = buildSelectClient({
      data: {
        id: 'w-1',
        restaurant_id: 'rest-1',
        phone_e164: '+85291234567',
        opened_at: '2026-05-04T09:00:00.000Z',
        last_inbound_at: '2026-05-04T09:30:00.000Z',
        expires_at: '2026-05-05T09:30:00.000Z',
      },
      error: null,
    })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    const result = await findOpenWindow({
      restaurantId: 'rest-1',
      phoneE164: '+85291234567',
      at,
    })

    expect(recorder.table).toBe('conversation_windows')
    expect(recorder.eqs).toEqual([
      { col: 'restaurant_id', val: 'rest-1' },
      { col: 'phone_e164', val: '+85291234567' },
    ])
    expect(recorder.gts).toEqual([
      { col: 'expires_at', val: at.toISOString() },
    ])
    expect(recorder.orders).toEqual([
      { column: 'expires_at', ascending: false },
    ])
    expect(recorder.limit).toBe(1)
    expect(result?.snapshot.id).toBe('w-1')
  })

  it('defaults `at` to now() when omitted', async () => {
    const { client, recorder } = buildSelectClient({
      data: null,
      error: null,
    })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)
    const before = Date.now()

    await findOpenWindow({ restaurantId: 'r', phoneE164: 'p' })

    const passed = Date.parse(recorder.gts[0].val as string)
    expect(passed).toBeGreaterThanOrEqual(before)
    expect(passed).toBeLessThanOrEqual(Date.now() + 1)
  })

  it('returns null when no open row exists', async () => {
    const { client } = buildSelectClient({ data: null, error: null })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)
    const result = await findOpenWindow({
      restaurantId: 'r',
      phoneE164: 'p',
    })
    expect(result).toBeNull()
  })

  it('throws contextually on database error', async () => {
    const { client } = buildSelectClient({
      data: null,
      error: { message: 'connection_failure' },
    })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)
    await expect(
      findOpenWindow({ restaurantId: 'r', phoneE164: 'p' })
    ).rejects.toThrow('findOpenWindow: connection_failure')
  })
})

describe('upsertOpenWindow', () => {
  beforeEach(() => vi.clearAllMocks())

  it('INSERTs a fresh row when no open window exists', async () => {
    const { client, recorder } = buildUpsertClient({ existing: null })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    const fresh = ConversationWindow.open({
      restaurantId: 'rest-1',
      phoneE164: '+85291234567',
      now: new Date('2026-05-04T10:00:00.000Z'),
    })
    const out = await upsertOpenWindow(fresh)

    expect(recorder.insertRecorder.table).toBe('conversation_windows')
    expect(recorder.insertRecorder.inserted).toMatchObject({
      restaurant_id: 'rest-1',
      phone_e164: '+85291234567',
      opened_at: '2026-05-04T10:00:00.000Z',
      last_inbound_at: '2026-05-04T10:00:00.000Z',
      expires_at: '2026-05-05T10:00:00.000Z',
    })
    expect(out.snapshot.id).toBe(fresh.snapshot.id)
    expect(recorder.updateCalls).toHaveLength(0)
  })

  it('UPDATEs (bumps) an existing open row instead of inserting', async () => {
    const existing = {
      id: 'w-existing',
      restaurant_id: 'rest-1',
      phone_e164: '+85291234567',
      opened_at: '2026-05-04T08:00:00.000Z',
      last_inbound_at: '2026-05-04T08:00:00.000Z',
      expires_at: '2026-05-05T08:00:00.000Z',
    }
    const { client, recorder } = buildUpsertClient({ existing })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    const fresh = ConversationWindow.open({
      restaurantId: 'rest-1',
      phoneE164: '+85291234567',
      now: new Date('2026-05-04T15:30:00.000Z'),
    })
    const out = await upsertOpenWindow(fresh)

    expect(recorder.insertRecorder.inserted).toBeNull()
    expect(recorder.updateCalls).toHaveLength(1)
    const call = recorder.updateCalls[0]
    expect(call.patch).toMatchObject({
      last_inbound_at: '2026-05-04T15:30:00.000Z',
      expires_at: '2026-05-05T15:30:00.000Z',
    })
    expect(call.eqs).toContainEqual({ col: 'id', val: 'w-existing' })
    // Returned entity preserves original openedAt + id.
    expect(out.snapshot.id).toBe('w-existing')
    expect(out.snapshot.openedAt).toBe('2026-05-04T08:00:00.000Z')
    expect(out.snapshot.lastInboundAt).toBe('2026-05-04T15:30:00.000Z')
    expect(out.snapshot.expiresAt).toBe('2026-05-05T15:30:00.000Z')
  })

  it('throws contextually on insert error', async () => {
    const { client } = buildUpsertClient({
      existing: null,
      insertError: { message: 'permission denied' },
    })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)
    const fresh = ConversationWindow.open({
      restaurantId: 'rest-1',
      phoneE164: '+85291234567',
    })
    await expect(upsertOpenWindow(fresh)).rejects.toThrow(
      'upsertOpenWindow: permission denied'
    )
  })

  it('throws contextually on update error', async () => {
    const existing = {
      id: 'w-existing',
      restaurant_id: 'rest-1',
      phone_e164: '+85291234567',
      opened_at: '2026-05-04T08:00:00.000Z',
      last_inbound_at: '2026-05-04T08:00:00.000Z',
      expires_at: '2026-05-05T08:00:00.000Z',
    }
    const { client } = buildUpsertClient({
      existing,
      updateError: { message: 'lock timeout' },
    })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)
    const fresh = ConversationWindow.open({
      restaurantId: 'rest-1',
      phoneE164: '+85291234567',
    })
    await expect(upsertOpenWindow(fresh)).rejects.toThrow(
      'upsertOpenWindow: lock timeout'
    )
  })
})

describe('isWindowOpen', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns true when an open row exists', async () => {
    const { client } = buildSelectClient({
      data: {
        id: 'w-1',
        restaurant_id: 'rest-1',
        phone_e164: '+85291234567',
        opened_at: '2026-05-04T09:00:00.000Z',
        last_inbound_at: '2026-05-04T09:30:00.000Z',
        expires_at: '2026-05-05T09:30:00.000Z',
      },
      error: null,
    })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)
    const out = await isWindowOpen({
      restaurantId: 'rest-1',
      phoneE164: '+85291234567',
    })
    expect(out).toBe(true)
  })

  it('returns false when no open row exists', async () => {
    const { client } = buildSelectClient({ data: null, error: null })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)
    const out = await isWindowOpen({
      restaurantId: 'rest-1',
      phoneE164: '+85291234567',
    })
    expect(out).toBe(false)
  })
})

describe('bulkIsWindowOpen', () => {
  beforeEach(() => vi.clearAllMocks())

  it('short-circuits to an empty Set when phones is empty', async () => {
    // No supabase call — no need to mock the client. Catch any unexpected call.
    const fail = vi.fn()
    vi.mocked(createServerSupabaseClient).mockImplementation(() => {
      fail()
      throw new Error('unexpected call')
    })
    const out = await bulkIsWindowOpen({ restaurantId: 'r', phones: [] })
    expect(out.size).toBe(0)
    expect(fail).not.toHaveBeenCalled()
  })

  it('returns the set of phones with open windows', async () => {
    const at = new Date('2026-05-04T10:00:00.000Z')
    const { client, recorder } = buildSelectClient({
      data: [{ phone_e164: '+85291234567' }, { phone_e164: '+85299999999' }],
      error: null,
    })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    const out = await bulkIsWindowOpen({
      restaurantId: 'rest-1',
      phones: ['+85291234567', '+85288888888', '+85299999999'],
      at,
    })

    expect(recorder.eqs).toEqual([{ col: 'restaurant_id', val: 'rest-1' }])
    expect(recorder.gts).toEqual([
      { col: 'expires_at', val: at.toISOString() },
    ])
    expect(recorder.ins).toEqual([
      {
        col: 'phone_e164',
        vals: ['+85291234567', '+85288888888', '+85299999999'],
      },
    ])
    expect(out).toEqual(new Set(['+85291234567', '+85299999999']))
  })

  it('throws contextually on database error', async () => {
    const { client } = buildSelectClient({
      data: null,
      error: { message: 'connection_failure' },
    })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)
    await expect(
      bulkIsWindowOpen({ restaurantId: 'r', phones: ['+1'] })
    ).rejects.toThrow('bulkIsWindowOpen: connection_failure')
  })
})

describe('conversationWindowRepository contract lock', () => {
  it('exposes the four operations from the same module', () => {
    expect(conversationWindowRepository.findOpen).toBe(findOpenWindow)
    expect(conversationWindowRepository.upsertOpen).toBe(upsertOpenWindow)
    expect(conversationWindowRepository.isOpen).toBe(isWindowOpen)
    expect(conversationWindowRepository.bulkIsOpen).toBe(bulkIsWindowOpen)
  })
})
