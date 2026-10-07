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
  rows?: Row[]
  rowsError?: { message: string }
}) {
  const calls: { table: string; select?: string; eq: [string, unknown][]; gte?: [string, unknown]; limit?: number }[] = []
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
      single: () => Promise.resolve(result),
      then: (res: (v: unknown) => unknown) => Promise.resolve(result).then(res),
    }
    return chain
  })
  vi.mocked(createServerSupabaseClient).mockReturnValue({ from } as never)
  return calls
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
})

describe('getMemberQualityEvidence', () => {
  it('scopes both queries by tenant and member, outbound only, and never selects content_preview', async () => {
    const calls = fakeClient({ member: { unreachable_at: null, pmm_throttled_until: null }, rows: [] })

    await getMemberQualityEvidence('m-1', 'r-1')

    const [members, messages] = calls
    expect(members.eq).toEqual(expect.arrayContaining([['id', 'm-1'], ['restaurant_id', 'r-1']]))
    expect(messages.table).toBe('whatsapp_messages')
    expect(messages.eq).toEqual(
      expect.arrayContaining([['restaurant_id', 'r-1'], ['member_id', 'm-1'], ['direction', 'outbound']])
    )
    expect(messages.gte?.[0]).toBe('queued_at')
    expect(messages.select).not.toContain('content_preview')
    expect(messages.select).not.toContain('*')
  })

  it('counts statuses (delivered includes read) and rates via the shared classifier', async () => {
    fakeClient({
      member: { unreachable_at: null, pmm_throttled_until: '2026-10-09T00:00:00Z' },
      rows: [
        row(1, 'delivered'),
        row(2, 'read'),
        row(3, 'read'),
        row(4, 'failed', { error_code: '131026', error_title: 'Undeliverable' }),
        row(5, 'sent'),
        row(6, 'queued'),
      ],
    })

    const ev = await getMemberQualityEvidence('m-1', 'r-1')

    expect(ev?.counts).toEqual({ delivered: 3, read: 2, failed: 1, pending: 2 })
    expect(ev?.quality).toEqual({ rating: 'yellow', deliveryRate: 0.75, sampleSize: 4, reason: 'meets_yellow' })
    expect(ev?.windowDays).toBe(90)
    expect(ev?.thresholds).toEqual({ green: 0.9, yellow: 0.6 })
    expect(ev?.pmmThrottledUntil).toBe('2026-10-09T00:00:00Z')
    expect(ev?.unreachableAt).toBeNull()
  })

  it('unreachable member is red with reason unreachable', async () => {
    fakeClient({ member: { unreachable_at: '2026-09-01T00:00:00Z', pmm_throttled_until: null }, rows: [row(1, 'delivered')] })
    const ev = await getMemberQualityEvidence('m-1', 'r-1')
    expect(ev?.quality.rating).toBe('red')
    expect(ev?.quality.reason).toBe('unreachable')
    expect(ev?.unreachableAt).toBe('2026-09-01T00:00:00Z')
  })

  it('recentMessages is the newest 20 with no content fields', async () => {
    fakeClient({
      member: { unreachable_at: null, pmm_throttled_until: null },
      rows: Array.from({ length: 25 }, (_, i) => row(i + 1, 'delivered')),
    })
    const ev = await getMemberQualityEvidence('m-1', 'r-1')
    expect(ev?.recentMessages).toHaveLength(20)
    expect(ev?.recentMessages[0]).toEqual({
      id: 'msg-1',
      queuedAt: row(1, 'delivered').queued_at,
      status: 'delivered',
      category: 'marketing',
      templateName: 'promo',
      errorCode: null,
      errorTitle: null,
    })
    expect(ev?.counts.delivered).toBe(25)
  })

  it('returns null for a member that does not resolve in this tenant', async () => {
    fakeClient({ member: null })
    expect(await getMemberQualityEvidence('m-x', 'r-1')).toBeNull()
  })

  it('throws when the row cap is hit (counts would silently disagree with the list RPC)', async () => {
    fakeClient({
      member: { unreachable_at: null, pmm_throttled_until: null },
      rows: Array.from({ length: 5000 }, (_, i) => row(i, 'delivered')),
    })
    await expect(getMemberQualityEvidence('m-1', 'r-1')).rejects.toThrow(/row cap/)
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
