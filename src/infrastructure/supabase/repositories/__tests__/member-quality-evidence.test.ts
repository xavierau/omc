import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../client', () => ({ createServerSupabaseClient: vi.fn() }))

import { createServerSupabaseClient } from '../../client'
import {
  getMemberQualityEvidence,
  getMemberQualityEvidenceSafe,
} from '../member-quality-evidence'

const NOW = new Date('2026-10-07T00:00:00Z')

type Row = { id: string; queued_at: string; status: string; category: string; template_name: string | null; error_code: string | null; error_title: string | null }
const row = (i: number, status: string, extra: Partial<Row> = {}): Row => ({
  id: `msg-${i}`,
  queued_at: new Date(NOW.getTime() - i * 3_600_000).toISOString(),
  status,
  category: 'marketing',
  template_name: 'promo',
  error_code: null,
  error_title: null,
  ...extra,
})

function fakeClient(opts: {
  member?: { unreachable_at: string | null; pmm_throttled_until: string | null } | null
  memberError?: { message: string }
  counts?: { delivered: number | string; read: number | string; failed: number | string; pending: number | string } | null
  countsError?: { message: string }
  rows?: Row[]
  rowsError?: { message: string }
}) {
  const calls: { table: string; select?: string; eq: [string, unknown][]; gte?: [string, unknown]; limit?: number }[] = []
  const rpc = vi.fn(() =>
    Promise.resolve({
      data: opts.counts ? [{ member_id: 'm-1', ...opts.counts }] : [],
      error: opts.countsError ?? null,
    })
  )
  const from = vi.fn((table: string) => {
    const call: (typeof calls)[number] = { table, eq: [] }
    calls.push(call)
    const result =
      table === 'members'
        ? { data: opts.member ?? null, error: opts.memberError ?? null }
        : { data: opts.rows ?? [], error: opts.rowsError ?? null }
    const chain: Record<string, unknown> = {
      select: (s: string) => ((call.select = s), chain),
      eq: (c: string, v: unknown) => (call.eq.push([c, v]), chain),
      gte: (c: string, v: unknown) => ((call.gte = [c, v]), chain),
      order: () => chain,
      limit: (n: number) => ((call.limit = n), chain),
      maybeSingle: () => Promise.resolve(result),
      then: (res: (v: unknown) => unknown) => Promise.resolve(result).then(res),
    }
    return chain
  })
  vi.mocked(createServerSupabaseClient).mockReturnValue({ from, rpc } as never)
  return Object.assign(calls, { rpc })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
})

describe('getMemberQualityEvidence', () => {
  const flags = { unreachable_at: null, pmm_throttled_until: null }

  it('scopes every query by tenant and member, outbound only, and never selects content_preview', async () => {
    const calls = fakeClient({ member: flags, rows: [] })

    await getMemberQualityEvidence('m-1', 'r-1')

    const [members, messages] = calls
    expect(members.eq).toEqual(expect.arrayContaining([['id', 'm-1'], ['restaurant_id', 'r-1']]))
    expect(calls.rpc).toHaveBeenCalledWith('member_delivery_quality', {
      p_restaurant_id: 'r-1',
      p_member_ids: ['m-1'],
      p_window_days: 90,
    })
    expect(messages.table).toBe('whatsapp_messages')
    expect(messages.eq).toEqual(
      expect.arrayContaining([['restaurant_id', 'r-1'], ['member_id', 'm-1'], ['direction', 'outbound']])
    )
    expect(messages.gte?.[0]).toBe('queued_at')
    expect(messages.select).not.toContain('content_preview')
    expect(messages.select).not.toContain('*')
  })

  it('takes counts (incl. read and pending) from the RPC and rates via the shared classifier', async () => {
    fakeClient({
      member: { unreachable_at: null, pmm_throttled_until: '2026-10-09T00:00:00Z' },
      counts: { delivered: '3', read: '2', failed: '1', pending: '2' },
      rows: [row(1, 'delivered')],
    })

    const ev = await getMemberQualityEvidence('m-1', 'r-1')

    expect(ev?.counts).toEqual({ delivered: 3, read: 2, failed: 1, pending: 2 })
    expect(ev?.quality).toEqual({ rating: 'yellow', deliveryRate: 0.75, sampleSize: 4, reason: 'meets_yellow' })
    expect(ev?.windowDays).toBe(90)
    expect(ev?.thresholds).toEqual({ green: 0.9, yellow: 0.6 })
    expect(ev?.pmmThrottledUntil).toBe('2026-10-09T00:00:00Z')
    expect(ev?.unreachableAt).toBeNull()
  })

  it('zero counts when the RPC returns no row', async () => {
    fakeClient({ member: flags, counts: null })
    const ev = await getMemberQualityEvidence('m-1', 'r-1')
    expect(ev?.counts).toEqual({ delivered: 0, read: 0, failed: 0, pending: 0 })
    expect(ev?.quality.rating).toBe('unknown')
  })

  it('unreachable member is red with reason unreachable', async () => {
    fakeClient({
      member: { unreachable_at: '2026-09-01T00:00:00Z', pmm_throttled_until: null },
      counts: { delivered: 1, read: 0, failed: 0, pending: 0 },
    })
    const ev = await getMemberQualityEvidence('m-1', 'r-1')
    expect(ev?.quality.rating).toBe('red')
    expect(ev?.quality.reason).toBe('unreachable')
    expect(ev?.unreachableAt).toBe('2026-09-01T00:00:00Z')
  })

  it('recent messages query is limited to the newest 20 (no row cap) and mapped without content fields', async () => {
    const calls = fakeClient({ member: flags, rows: [row(1, 'delivered')] })
    const ev = await getMemberQualityEvidence('m-1', 'r-1')
    expect(calls[1].limit).toBe(20)
    expect(ev?.recentMessages[0]).toEqual({
      id: 'msg-1',
      queuedAt: row(1, 'delivered').queued_at,
      status: 'delivered',
      category: 'marketing',
      templateName: 'promo',
      errorCode: null,
      errorTitle: null,
    })
  })

  it('returns null for a member that does not resolve in this tenant, without throwing', async () => {
    fakeClient({ member: null })
    expect(await getMemberQualityEvidence('m-x', 'r-1')).toBeNull()
  })

  it('missing member degrades to null with no warn (Safe wrapper)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    fakeClient({ member: null })
    expect(await getMemberQualityEvidenceSafe('m-x', 'r-1')).toBeNull()
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it('throws on an RPC error', async () => {
    fakeClient({ member: flags, countsError: { message: 'rpc down' } })
    await expect(getMemberQualityEvidence('m-1', 'r-1')).rejects.toThrow(/counts/)
  })
})

describe('getMemberQualityEvidenceSafe', () => {
  it('degrades to null with console.warn on any error', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    fakeClient({ member: { unreachable_at: null, pmm_throttled_until: null }, rowsError: { message: 'boom' } })

    expect(await getMemberQualityEvidenceSafe('m-1', 'r-1')).toBeNull()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})
