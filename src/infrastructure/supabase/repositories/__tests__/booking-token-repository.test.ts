import { describe, it, expect, vi, beforeEach } from 'vitest'
import { recordingSupabase, filtersOf } from '@/test-utils/recording-supabase'

vi.mock('@/infrastructure/supabase/client', () => ({ createServerSupabaseClient: vi.fn() }))

import { createServerSupabaseClient } from '@/infrastructure/supabase/client'
import {
  claimBookingToken,
  findLiveChatToken,
  generateBookingToken,
  mintBookingToken,
  peekBookingToken,
  releaseBookingToken,
} from '../booking-token-repository'

const TOKEN = 'T'.repeat(43)
const NOW = new Date('2026-11-12T10:00:00.000Z')

function use(results: Parameters<typeof recordingSupabase>[0]) {
  const rec = recordingSupabase(results)
  vi.mocked(createServerSupabaseClient).mockReturnValue(rec.client as never)
  return rec
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('generateBookingToken (R1)', () => {
  it('is at least 43 URL-safe chars and unique over 1,000 mints', () => {
    const tokens = Array.from({ length: 1000 }, generateBookingToken)
    expect(new Set(tokens).size).toBe(1000)
    for (const token of tokens) expect(token).toMatch(/^[A-Za-z0-9_-]{43,}$/)
  })
})

describe('mintBookingToken', () => {
  it('stores the token with the given owner and expiry from the lifetime', async () => {
    const rec = use([{ error: null }])
    const token = await mintBookingToken({
      restaurantId: 'r-a', phone: '+85291234567', source: 'chat', campaignId: null, ttlHours: 24, now: NOW,
    })
    const [, row] = rec.queries[0].calls[0] as [string, Record<string, unknown>]
    expect(rec.queries[0].table).toBe('booking_tokens')
    expect(row).toEqual({
      token, restaurant_id: 'r-a', phone: '+85291234567', source: 'chat', campaign_id: null,
      expires_at: '2026-11-13T10:00:00.000Z',
    })
  })

  it('stores a null expiry for a no-expiry lifetime and returns null on a DB error', async () => {
    const rec = use([{ error: null }])
    await mintBookingToken({ restaurantId: 'r', phone: '+1', source: 'campaign', campaignId: 'c', ttlHours: null })
    expect((rec.queries[0].calls[0][1] as Record<string, unknown>).expires_at).toBeNull()

    use([{ error: { message: 'boom' } }])
    expect(await mintBookingToken({ restaurantId: 'r', phone: '+1', source: 'chat', campaignId: null, ttlHours: 1 })).toBeNull()
  })
})

describe('peekBookingToken', () => {
  const row = { restaurant_id: 'r-a', phone: '+852', source: 'chat', campaign_id: null, consumed_at: null }

  it('reports valid / expired / consumed / unknown without writing', async () => {
    use([{ data: { ...row, expires_at: null } }])
    expect((await peekBookingToken(TOKEN, NOW)).state).toBe('valid')
    use([{ data: { ...row, expires_at: '2026-11-12T09:00:00Z' } }])
    expect((await peekBookingToken(TOKEN, NOW)).state).toBe('expired')
    use([{ data: { ...row, expires_at: null, consumed_at: '2026-11-12T09:00:00Z' } }])
    expect((await peekBookingToken(TOKEN, NOW)).state).toBe('consumed')
    const rec = use([{ data: null }])
    expect(await peekBookingToken(TOKEN, NOW)).toEqual({ state: 'unknown', owner: null })
    expect(rec.queries[0].calls.map(([m]) => m)).not.toContain('update')
  })

  it('never queries for a malformed token', async () => {
    const rec = use([])
    expect((await peekBookingToken('../etc', NOW)).state).toBe('unknown')
    expect(rec.queries).toHaveLength(0)
  })
})

describe('claimBookingToken (R1)', () => {
  it('is a conditional update: unconsumed and (no expiry or not expired)', async () => {
    const rec = use([{ data: { restaurant_id: 'r-a', phone: '+852', source: 'campaign', campaign_id: 'c-1' } }])
    const owner = await claimBookingToken(TOKEN, NOW)
    expect(owner).toEqual({ restaurantId: 'r-a', phone: '+852', source: 'campaign', campaignId: 'c-1' })
    expect(rec.queries[0].calls[0]).toEqual(['update', { consumed_at: NOW.toISOString() }])
    expect(filtersOf(rec.queries[0])).toEqual([
      `eq:token=${TOKEN}`,
      'is:consumed_at=null',
      `or:expires_at.is.null,expires_at.gt.${NOW.toISOString()}`,
    ])
  })

  it('returns null when no row changed (already used or expired)', async () => {
    use([{ data: null }])
    expect(await claimBookingToken(TOKEN, NOW)).toBeNull()
  })
})

describe('releaseBookingToken / findLiveChatToken', () => {
  it('re-arms only the claim this caller made', async () => {
    const rec = use([{ error: null }])
    await releaseBookingToken(TOKEN, NOW)
    expect(rec.queries[0].calls[0]).toEqual(['update', { consumed_at: null }])
    expect(filtersOf(rec.queries[0])).toEqual([`eq:token=${TOKEN}`, `eq:consumed_at=${NOW.toISOString()}`])
  })

  it('finds the newest live chat link for the sender at this restaurant', async () => {
    const rec = use([{ data: { token: TOKEN, expires_at: null } }])
    expect(await findLiveChatToken('r-a', '+852', NOW)).toBe(TOKEN)
    expect(filtersOf(rec.queries[0])).toEqual([
      'eq:restaurant_id=r-a', 'eq:phone=+852', 'eq:source=chat', 'is:consumed_at=null',
      `or:expires_at.is.null,expires_at.gt.${NOW.toISOString()}`,
    ])
  })

  // F5 (review #3): reuse only with no expiry or >= 1h left, else mint anew.
  it('does not reuse a live link with under an hour left; reuses one with an hour or more', async () => {
    const left = (ms: number) => new Date(NOW.getTime() + ms).toISOString()
    use([{ data: { token: TOKEN, expires_at: left(30 * 60_000) } }])
    expect(await findLiveChatToken('r-a', '+852', NOW)).toBeNull()
    use([{ data: { token: TOKEN, expires_at: left(3_600_000) } }])
    expect(await findLiveChatToken('r-a', '+852', NOW)).toBe(TOKEN)
  })
})
