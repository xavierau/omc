import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../client', () => ({
  createServerSupabaseClient: vi.fn(),
}))

import { createServerSupabaseClient } from '../../client'
import {
  attachKapsoMessageId,
  countMarketingSendsLast24h,
  countMarketingSendsLast24hForPhones,
} from '../whatsapp-message-repository'

interface QueryRecorder {
  update: Record<string, unknown> | null
  eqs: Array<{ col: string; val: unknown }>
}

function buildUpdateClient(opts: { error: { message: string } | null } = { error: null }): {
  client: ReturnType<typeof createServerSupabaseClient>
  recorder: QueryRecorder
} {
  const recorder: QueryRecorder = { update: null, eqs: [] }
  // The chain we need: .from('whatsapp_messages').update(payload).eq('id', id).eq('status', 'queued')
  // The terminal eq() (the second one) resolves to { error }.
  // This represents both "rows matched, update applied" and "no rows matched"
  // (Supabase returns `{ data: null, error: null }` for no-match UPDATEs by default).
  const eqTerminal = vi.fn().mockImplementation((col: string, val: unknown) => {
    recorder.eqs.push({ col, val })
    return Promise.resolve({ data: null, error: opts.error })
  })
  const eqFirst = vi.fn().mockImplementation((col: string, val: unknown) => {
    recorder.eqs.push({ col, val })
    return { eq: eqTerminal }
  })
  const update = vi.fn().mockImplementation((u: Record<string, unknown>) => {
    recorder.update = u
    return { eq: eqFirst }
  })
  const from = vi.fn().mockReturnValue({ update })
  return {
    client: { from } as unknown as ReturnType<typeof createServerSupabaseClient>,
    recorder,
  }
}

describe('attachKapsoMessageId — status guard + raw payload (FIX 1+2)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('issues a status-guarded UPDATE that includes raw_send_response', async () => {
    const { client, recorder } = buildUpdateClient()
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    const raw = { messages: [{ id: 'wamid.X' }] }
    await attachKapsoMessageId('local-uuid-1', 'wamid.X', raw)

    expect(recorder.update).toEqual({
      kapso_message_id: 'wamid.X',
      raw_send_response: raw,
      status: 'sent',
      sent_at: expect.any(String),
    })
    // Must call .eq('id', ...) AND .eq('status', 'queued') — second eq is the
    // race guard that prevents regressing a delivered/read row back to sent.
    expect(recorder.eqs).toEqual([
      { col: 'id', val: 'local-uuid-1' },
      { col: 'status', val: 'queued' },
    ])
  })

  it('persists null raw payload when caller has no BSP body', async () => {
    const { client, recorder } = buildUpdateClient()
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    await attachKapsoMessageId('local-uuid-2', 'wamid.Y', null)

    expect(recorder.update?.raw_send_response).toBe(null)
  })

  it('is a no-op (no error thrown) when the row has already advanced past queued', async () => {
    // Supabase returns { data: null, error: null } when the UPDATE matches no
    // rows — this is the intended behavior for a row whose webhook arrived
    // first and progressed status to delivered/read. We must not throw.
    const { client } = buildUpdateClient({ error: null })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    await expect(
      attachKapsoMessageId('local-uuid-3', 'wamid.Z', null)
    ).resolves.toBeUndefined()
  })

  it('throws a contextual error when the database itself returns an error', async () => {
    const { client } = buildUpdateClient({ error: { message: 'permission denied' } })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    await expect(
      attachKapsoMessageId('local-uuid-4', 'wamid.W', null)
    ).rejects.toThrow('attachKapsoMessageId: permission denied')
  })
})

// ---------------------------------------------------------------------------
// WAQ-007 — per-recipient marketing-send counters powering the cooldown gate.
// ---------------------------------------------------------------------------

interface CountRecorder {
  selected?: string
  selectOpts?: { count?: 'exact'; head?: boolean }
  eqs: Array<{ col: string; val: unknown }>
  ins: Array<{ col: string; vals: unknown[] }>
  gts: Array<{ col: string; val: unknown }>
}

function buildCountClient(result: {
  count: number | null
  data?: Array<Record<string, unknown>> | null
  error: { message: string } | null
}): {
  client: ReturnType<typeof createServerSupabaseClient>
  recorder: CountRecorder
} {
  const recorder: CountRecorder = { eqs: [], ins: [], gts: [] }
  // Terminal "thenable" — chain ends here. Resolves with both `count` and
  // `data` so the same builder serves the per-phone count() path AND the
  // bulk select() path (whichever the caller awaits).
  const terminal = {
    then: (resolve: (v: unknown) => void) =>
      resolve({
        count: result.count,
        data: result.data ?? null,
        error: result.error,
      }),
  }
  const gt = vi.fn().mockImplementation((col: string, val: unknown) => {
    recorder.gts.push({ col, val })
    return terminal
  })
  const inFn = vi.fn().mockImplementation((col: string, vals: unknown[]) => {
    recorder.ins.push({ col, vals })
    return { in: inFn, eq: eqFn, gt }
  })
  const eqFn: ReturnType<typeof vi.fn> = vi.fn()
  eqFn.mockImplementation((col: string, val: unknown) => {
    recorder.eqs.push({ col, val })
    return { eq: eqFn, in: inFn, gt }
  })
  const select = vi.fn().mockImplementation(
    (cols: string, opts?: { count?: 'exact'; head?: boolean }) => {
      recorder.selected = cols
      recorder.selectOpts = opts
      return { eq: eqFn, in: inFn, gt }
    }
  )
  const from = vi.fn().mockReturnValue({ select })
  return {
    client: { from } as unknown as ReturnType<typeof createServerSupabaseClient>,
    recorder,
  }
}

describe('countMarketingSendsLast24h', () => {
  beforeEach(() => vi.clearAllMocks())

  it('issues a head-only count() filtered by restaurant, phone, category, status, and 24h window', async () => {
    const { client, recorder } = buildCountClient({ count: 0, error: null })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    await countMarketingSendsLast24h({
      restaurantId: 'r-1',
      phoneE164: '85291234567',
    })

    // count: 'exact', head: true is the cheap path — no row payload returned.
    expect(recorder.selectOpts).toEqual({ count: 'exact', head: true })
    // Tenant + recipient + classification — no cross-tenant leakage.
    expect(recorder.eqs).toEqual([
      { col: 'restaurant_id', val: 'r-1' },
      { col: 'phone_e164', val: '85291234567' },
      { col: 'category', val: 'marketing' },
    ])
    // Failed sends do NOT count toward the cap (Meta tracks accepted-by-WhatsApp).
    expect(recorder.ins).toEqual([
      { col: 'status', vals: ['sent', 'delivered', 'read'] },
    ])
    // Sliding 24h window from now.
    expect(recorder.gts).toHaveLength(1)
    expect(recorder.gts[0].col).toBe('sent_at')
    const cutoff = new Date(recorder.gts[0].val as string).getTime()
    const expected = Date.now() - 24 * 3600_000
    // Allow ±5s for test runtime jitter.
    expect(Math.abs(cutoff - expected)).toBeLessThan(5000)
  })

  it('returns the count from Supabase', async () => {
    const { client } = buildCountClient({ count: 3, error: null })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    const n = await countMarketingSendsLast24h({
      restaurantId: 'r-1',
      phoneE164: '85291234567',
    })
    expect(n).toBe(3)
  })

  it('returns 0 when count is null (defensive — Supabase can omit count on empty results)', async () => {
    const { client } = buildCountClient({ count: null, error: null })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    const n = await countMarketingSendsLast24h({
      restaurantId: 'r-1',
      phoneE164: '85291234567',
    })
    expect(n).toBe(0)
  })

  it('throws a contextual error when the database returns an error', async () => {
    const { client } = buildCountClient({
      count: null,
      error: { message: 'connection lost' },
    })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    await expect(
      countMarketingSendsLast24h({
        restaurantId: 'r-1',
        phoneE164: '85291234567',
      })
    ).rejects.toThrow(/countMarketingSendsLast24h.*connection lost/)
  })
})

describe('countMarketingSendsLast24hForPhones', () => {
  beforeEach(() => vi.clearAllMocks())

  it('short-circuits to an empty Map without a DB call when phones is empty', async () => {
    const { client } = buildCountClient({ count: 0, data: [], error: null })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    const map = await countMarketingSendsLast24hForPhones({
      restaurantId: 'r-1',
      phones: [],
    })
    expect(map.size).toBe(0)
    expect(client.from).not.toHaveBeenCalled()
  })

  it('issues ONE select with .in(phone_e164, [...]) and groups counts in JS (no N+1)', async () => {
    const { client, recorder } = buildCountClient({
      count: null,
      data: [
        { phone_e164: '85291111111' },
        { phone_e164: '85291111111' }, // 2 sends to same phone
        { phone_e164: '85292222222' }, // 1 send
        // 85293333333 has no rows → must be absent or 0
      ],
      error: null,
    })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    const phones = ['85291111111', '85292222222', '85293333333']
    const map = await countMarketingSendsLast24hForPhones({
      restaurantId: 'r-1',
      phones,
    })

    // Single round-trip — caller-side grouping does the rest.
    expect(client.from).toHaveBeenCalledTimes(1)
    expect(recorder.selected).toBe('phone_e164')
    expect(recorder.eqs).toEqual([
      { col: 'restaurant_id', val: 'r-1' },
      { col: 'category', val: 'marketing' },
    ])
    // The phone IN-clause AND status IN-clause together — order-insensitive.
    const phonesIn = recorder.ins.find((i) => i.col === 'phone_e164')
    const statusIn = recorder.ins.find((i) => i.col === 'status')
    expect(phonesIn?.vals).toEqual(phones)
    expect(statusIn?.vals).toEqual(['sent', 'delivered', 'read'])

    expect(map.get('85291111111')).toBe(2)
    expect(map.get('85292222222')).toBe(1)
    // Phones with no sends are absent — callers default to 0.
    expect(map.has('85293333333')).toBe(false)
  })

  it('returns an empty map when no rows match (e.g. brand-new tenant)', async () => {
    const { client } = buildCountClient({ count: null, data: [], error: null })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    const map = await countMarketingSendsLast24hForPhones({
      restaurantId: 'r-1',
      phones: ['85291111111'],
    })
    expect(map.size).toBe(0)
  })

  it('throws a contextual error when the database returns an error', async () => {
    const { client } = buildCountClient({
      count: null,
      data: null,
      error: { message: 'permission denied' },
    })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    await expect(
      countMarketingSendsLast24hForPhones({
        restaurantId: 'r-1',
        phones: ['85291111111'],
      })
    ).rejects.toThrow(/countMarketingSendsLast24hForPhones.*permission denied/)
  })
})
