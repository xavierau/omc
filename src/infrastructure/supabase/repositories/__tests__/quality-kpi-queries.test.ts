// WAQ-012 quality-dashboard KPI aggregations.
//
// These functions read whatsapp_messages + consent_records and emit per-
// tenant counters scoped to the marketing category over a sliding window.
// Tests cover: scope (restaurant + marketing + window), rate derivation
// (delivery / read / error / opt-out), zero-division safety, and the bulk
// "all tenants" variant that returns a Map keyed by restaurant_id.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../client', () => ({
  createServerSupabaseClient: vi.fn(),
}))

import { createServerSupabaseClient } from '../../client'
import {
  getQualityKpisForTenant,
  getQualityKpisForAllTenants,
} from '../quality-kpi-queries'

type SupabaseClient = ReturnType<typeof createServerSupabaseClient>

interface CallLog {
  table: string | null
  selectArgs: Array<{ cols: string; opts?: Record<string, unknown> }>
  eqs: Array<{ col: string; val: unknown }>
  gts: Array<{ col: string; val: unknown }>
  ins: Array<{ col: string; vals: unknown[] }>
}

function newLog(): CallLog {
  return { table: null, selectArgs: [], eqs: [], gts: [], ins: [] }
}

interface Result {
  data?: unknown
  count?: number | null
  error?: { message: string } | null
}

// Build a chainable Supabase mock where the terminal "thenable" resolves
// with whatever the test sets. One mock client per call site keeps the
// counter assertions simple.
function buildClient(
  resultsByTable: Record<string, Result>
): { client: SupabaseClient; logs: Record<string, CallLog> } {
  const logs: Record<string, CallLog> = {}

  const from = vi.fn().mockImplementation((t: string) => {
    if (!logs[t]) logs[t] = newLog()
    const log = logs[t]
    log.table = t
    const result = resultsByTable[t] ?? { data: [], count: 0, error: null }
    return buildBuilder(log, result)
  })
  return {
    client: { from } as unknown as SupabaseClient,
    logs,
  }
}

function buildBuilder(log: CallLog, result: Result): Record<string, unknown> {
  const terminal = {
    then: (resolve: (v: unknown) => void) =>
      resolve({
        data: result.data ?? null,
        count: result.count ?? null,
        error: result.error ?? null,
      }),
  }
  const builder: Record<string, unknown> = {}
  builder.select = vi.fn().mockImplementation(
    (cols: string, opts?: Record<string, unknown>) => {
      log.selectArgs.push({ cols, opts })
      return builder
    }
  )
  builder.eq = vi.fn().mockImplementation((col: string, val: unknown) => {
    log.eqs.push({ col, val })
    return builder
  })
  builder.in = vi.fn().mockImplementation((col: string, vals: unknown[]) => {
    log.ins.push({ col, vals })
    return builder
  })
  builder.gt = vi.fn().mockImplementation((col: string, val: unknown) => {
    log.gts.push({ col, val })
    return terminal
  })
  builder.gte = vi.fn().mockImplementation((col: string, val: unknown) => {
    log.gts.push({ col, val })
    return terminal
  })
  return builder
}

beforeEach(() => vi.clearAllMocks())

describe('getQualityKpisForTenant', () => {
  it('aggregates marketing whatsapp_messages over the requested window scoped to the tenant', async () => {
    const now = new Date('2026-05-04T00:00:00.000Z')
    const messages = [
      { status: 'sent' },
      { status: 'sent' },
      { status: 'delivered' },
      { status: 'delivered' },
      { status: 'read' },
      { status: 'failed' },
    ]
    const { client, logs } = buildClient({
      whatsapp_messages: { data: messages, error: null },
      consent_records: { data: [{ id: 'c1' }], error: null },
    })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    const kpis = await getQualityKpisForTenant({
      restaurantId: 'rest-1',
      windowDays: 7,
      now,
    })

    // totalSends = sent + delivered + read + failed = 6
    // delivered (terminal-or-better, i.e. delivered+read) = 3
    // read = 1
    // failed = 1
    // optedOut = 1 (one consent_records row in window)
    expect(kpis.totalSends).toBe(6)
    expect(kpis.delivered).toBe(3)
    expect(kpis.read).toBe(1)
    expect(kpis.failed).toBe(1)
    expect(kpis.optedOut).toBe(1)
    expect(kpis.deliveryRate).toBeCloseTo(3 / 6)
    expect(kpis.readRate).toBeCloseTo(1 / 3)
    expect(kpis.errorRate).toBeCloseTo(1 / 6)
    expect(kpis.optOutRate).toBeCloseTo(1 / 6)

    const wa = logs.whatsapp_messages
    expect(wa.eqs).toEqual([
      { col: 'restaurant_id', val: 'rest-1' },
      { col: 'category', val: 'marketing' },
    ])
    // 7-day window cutoff
    expect(wa.gts).toHaveLength(1)
    expect(wa.gts[0].col).toBe('queued_at')
    const expectedCutoff = new Date(
      now.getTime() - 7 * 24 * 3600_000
    ).toISOString()
    expect(wa.gts[0].val).toBe(expectedCutoff)

    const cr = logs.consent_records
    expect(cr.eqs).toEqual([
      { col: 'restaurant_id', val: 'rest-1' },
      { col: 'category', val: 'marketing' },
      { col: 'status', val: 'opted_out' },
    ])
    expect(cr.gts[0].col).toBe('revoked_at')
  })

  it('returns zero rates without dividing by zero when there are no sends', async () => {
    const { client } = buildClient({
      whatsapp_messages: { data: [], error: null },
      consent_records: { data: [], error: null },
    })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    const kpis = await getQualityKpisForTenant({
      restaurantId: 'rest-empty',
      windowDays: 7,
    })

    expect(kpis.totalSends).toBe(0)
    expect(kpis.deliveryRate).toBe(0)
    expect(kpis.readRate).toBe(0)
    expect(kpis.errorRate).toBe(0)
    expect(kpis.optOutRate).toBe(0)
  })

  it('throws a contextual error when the messages query fails', async () => {
    const { client } = buildClient({
      whatsapp_messages: { error: { message: 'db down' } },
      consent_records: { data: [], error: null },
    })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    await expect(
      getQualityKpisForTenant({ restaurantId: 'rest-1', windowDays: 7 })
    ).rejects.toThrow(/getQualityKpisForTenant/)
  })
})

describe('getQualityKpisForAllTenants', () => {
  it('groups KPIs by restaurant_id (one row per tenant)', async () => {
    const messages = [
      { restaurant_id: 'a', status: 'sent' },
      { restaurant_id: 'a', status: 'delivered' },
      { restaurant_id: 'a', status: 'read' },
      { restaurant_id: 'a', status: 'failed' },
      { restaurant_id: 'b', status: 'sent' },
      { restaurant_id: 'b', status: 'delivered' },
    ]
    const consents = [
      { restaurant_id: 'a' },
      { restaurant_id: 'a' },
      { restaurant_id: 'b' },
    ]
    const { client } = buildClient({
      whatsapp_messages: { data: messages, error: null },
      consent_records: { data: consents, error: null },
    })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    const map = await getQualityKpisForAllTenants({ windowDays: 7 })

    const a = map.get('a')!
    expect(a.totalSends).toBe(4)
    expect(a.delivered).toBe(2) // delivered+read
    expect(a.read).toBe(1)
    expect(a.failed).toBe(1)
    expect(a.optedOut).toBe(2)
    expect(a.deliveryRate).toBeCloseTo(2 / 4)
    expect(a.readRate).toBeCloseTo(1 / 2)
    expect(a.errorRate).toBeCloseTo(1 / 4)
    expect(a.optOutRate).toBeCloseTo(2 / 4)

    const b = map.get('b')!
    expect(b.totalSends).toBe(2)
    expect(b.delivered).toBe(1)
    expect(b.optedOut).toBe(1)
  })

  it('returns an empty map when there are no messages and no opt-outs', async () => {
    const { client } = buildClient({
      whatsapp_messages: { data: [], error: null },
      consent_records: { data: [], error: null },
    })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    const map = await getQualityKpisForAllTenants({ windowDays: 7 })
    expect(map.size).toBe(0)
  })

  it('still emits a row for tenants with only opt-outs (no sends)', async () => {
    const { client } = buildClient({
      whatsapp_messages: { data: [], error: null },
      consent_records: { data: [{ restaurant_id: 'c' }], error: null },
    })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    const map = await getQualityKpisForAllTenants({ windowDays: 7 })
    expect(map.get('c')).toMatchObject({
      totalSends: 0,
      optedOut: 1,
      optOutRate: 0,
    })
  })
})
