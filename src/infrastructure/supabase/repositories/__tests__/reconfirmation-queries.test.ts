import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../client', () => ({
  createServerSupabaseClient: vi.fn(),
}))

import { createServerSupabaseClient } from '../../client'
import { findReconfirmationAudienceSample } from '../reconfirmation-queries'

interface QueryRecorder {
  table?: string
  selected?: string
  eqs: Array<{ col: string; val: unknown }>
  orders: Array<{ col: string; opts: { ascending: boolean } | undefined }>
  limited?: number
}

function buildClient(
  rows: Array<Record<string, unknown>>,
  error: { message: string } | null = null
): {
  client: ReturnType<typeof createServerSupabaseClient>
  recorder: QueryRecorder
} {
  const recorder: QueryRecorder = { eqs: [], orders: [] }
  const limit = vi.fn().mockImplementation((n: number) => {
    recorder.limited = n
    return Promise.resolve({ data: rows, error })
  })
  const order = vi.fn().mockImplementation(
    (col: string, opts: { ascending: boolean } | undefined) => {
      recorder.orders.push({ col, opts })
      return { limit }
    }
  )
  const eq = vi.fn()
  const eqChain = { eq, order, limit }
  eq.mockImplementation((col: string, val: unknown) => {
    recorder.eqs.push({ col, val })
    return eqChain
  })
  const select = vi.fn().mockImplementation((cols: string) => {
    recorder.selected = cols
    return eqChain
  })
  const from = vi.fn().mockImplementation((table: string) => {
    recorder.table = table
    return { select }
  })
  return {
    client: { from } as unknown as ReturnType<typeof createServerSupabaseClient>,
    recorder,
  }
}

describe('findReconfirmationAudienceSample', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns the first N rows projected as { phoneE164, capturedAt }', async () => {
    const { client, recorder } = buildClient([
      {
        captured_at: '2026-04-30T01:00:00.000Z',
        members: { phone_e164: '+85291111111', restaurant_id: 'r-1' },
      },
      {
        captured_at: '2026-04-29T01:00:00.000Z',
        members: { phone_e164: '+85292222222', restaurant_id: 'r-1' },
      },
    ])
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    const r = await findReconfirmationAudienceSample({
      restaurantId: 'r-1',
      limit: 5,
    })

    expect(r).toEqual([
      { phoneE164: '+85291111111', capturedAt: '2026-04-30T01:00:00.000Z' },
      { phoneE164: '+85292222222', capturedAt: '2026-04-29T01:00:00.000Z' },
    ])
    expect(recorder.table).toBe('consent_records')
    expect(recorder.eqs).toEqual(
      expect.arrayContaining([
        { col: 'restaurant_id', val: 'r-1' },
        { col: 'category', val: 'marketing' },
        { col: 'status', val: 'opted_in' },
        { col: 'consent_grade', val: 'weak' },
      ])
    )
    expect(recorder.orders[0]).toEqual({
      col: 'captured_at',
      opts: { ascending: false },
    })
    expect(recorder.limited).toBe(5)
  })

  it('returns an empty array when no rows match', async () => {
    const { client } = buildClient([])
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)
    const r = await findReconfirmationAudienceSample({
      restaurantId: 'r-1',
      limit: 5,
    })
    expect(r).toEqual([])
  })

  it('skips rows whose embedded member is missing (orphaned consent rows)', async () => {
    const { client } = buildClient([
      {
        captured_at: '2026-04-30T00:00:00.000Z',
        members: null,
      },
      {
        captured_at: '2026-04-29T00:00:00.000Z',
        members: { phone_e164: '+85291111111', restaurant_id: 'r-1' },
      },
    ])
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)
    const r = await findReconfirmationAudienceSample({
      restaurantId: 'r-1',
      limit: 5,
    })
    expect(r).toEqual([
      { phoneE164: '+85291111111', capturedAt: '2026-04-29T00:00:00.000Z' },
    ])
  })

  // Defence-in-depth (review finding 5): preflight dialog preview must NOT
  // leak another tenant's phone number even if a corrupted DB state lets the
  // join return a cross-tenant member row.
  it('skips rows whose embedded member belongs to a different tenant', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { client } = buildClient([
      {
        captured_at: '2026-04-30T00:00:00.000Z',
        members: { phone_e164: '+85299999999', restaurant_id: 'OTHER' },
      },
      {
        captured_at: '2026-04-29T00:00:00.000Z',
        members: { phone_e164: '+85291111111', restaurant_id: 'r-1' },
      },
    ])
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)
    const r = await findReconfirmationAudienceSample({
      restaurantId: 'r-1',
      limit: 5,
    })
    expect(r).toEqual([
      { phoneE164: '+85291111111', capturedAt: '2026-04-29T00:00:00.000Z' },
    ])
    expect(warn).toHaveBeenCalledWith(
      '[reconfirmation] cross-tenant member skipped',
      expect.objectContaining({
        memberRestaurantId: 'OTHER',
        requestedRestaurantId: 'r-1',
      })
    )
    warn.mockRestore()
  })

  it('throws when supabase returns an error', async () => {
    const { client } = buildClient([], { message: 'boom' })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)
    await expect(
      findReconfirmationAudienceSample({ restaurantId: 'r-1', limit: 5 })
    ).rejects.toThrow(/boom/)
  })
})
