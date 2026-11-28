// BOOK-001 W2-07 (AC-7, R17): the classification row and its duplicate path.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { filtersOf, recordingSupabase } from '@/test-utils/recording-supabase'

vi.mock('@/infrastructure/supabase/client', () => ({ createServerSupabaseClient: vi.fn() }))

import { createServerSupabaseClient } from '@/infrastructure/supabase/client'
import { recordInboundClassification } from '../inbound-classification-repository'

const ROW = { restaurantId: 'r1', messageId: 'wamid.1', label: 'booking' as const, confidence: 0.8, outcome: 'booking_reply' as const }

type Scripted = { data?: unknown; error?: { message: string; code?: string } | null }
const DUP = { error: { message: 'duplicate key value violates unique constraint', code: '23505' } }

function useResult(result: Scripted, ...more: Scripted[]) {
  const db = recordingSupabase([result, ...more])
  vi.mocked(createServerSupabaseClient).mockReturnValue(db.client as never)
  return db
}

describe('recordInboundClassification', () => {
  beforeEach(() => vi.clearAllMocks())

  it('inserts label, confidence, outcome and message id; no text column', async () => {
    const db = useResult({ error: null })
    expect(await recordInboundClassification(ROW)).toEqual({ status: 'recorded' })
    expect(db.queries[0].table).toBe('inbound_classifications')
    expect(db.queries[0].calls).toEqual([[
      'insert',
      { restaurant_id: 'r1', message_id: 'wamid.1', label: 'booking', confidence: 0.8, outcome: 'booking_reply' },
    ]])
  })

  it('stores null label and confidence for the error outcome', async () => {
    const db = useResult({ error: null })
    await recordInboundClassification({ ...ROW, label: null, confidence: null, outcome: 'error' })
    expect(db.queries[0].calls[0][1]).toMatchObject({ label: null, confidence: null, outcome: 'error' })
  })

  it('a replayed wamid (23505) → duplicate carrying the stored outcome (BOOK-012 r2)', async () => {
    const db = useResult(DUP, { data: { outcome: 'fallback' } })
    expect(await recordInboundClassification(ROW)).toEqual({ status: 'duplicate', earlierOutcome: 'fallback' })
    expect(db.queries[1].table).toBe('inbound_classifications')
    expect(db.queries[1].calls[0]).toEqual(['select', 'outcome'])
    expect(filtersOf(db.queries[1])).toEqual(['eq:restaurant_id=r1', 'eq:message_id=wamid.1'])
  })

  it('the first delivery is one round trip (no lookup)', async () => {
    const db = useResult({ error: null })
    await recordInboundClassification(ROW)
    expect(db.queries).toHaveLength(1)
  })

  it.each<[string, Scripted]>([
    ['the lookup errors', { error: { message: 'boom', code: '08006' } }],
    ['no row comes back', { data: null }],
    ['an unexpected outcome value', { data: { outcome: 'weird' } }],
  ])('duplicate whose earlier outcome is unknown (%s) → earlierOutcome null, no throw', async (_, lookup) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    useResult(DUP, lookup)
    expect(await recordInboundClassification(ROW)).toEqual({ status: 'duplicate', earlierOutcome: null })
    warn.mockRestore()
  })

  it('any other error or a throw → failed, never throws', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    useResult({ error: { message: 'boom wamid.1', code: '42501' } })
    expect(await recordInboundClassification(ROW)).toEqual({ status: 'failed' })
    vi.mocked(createServerSupabaseClient).mockImplementation(() => { throw new Error('no env') })
    expect(await recordInboundClassification(ROW)).toEqual({ status: 'failed' })
    expect(JSON.stringify(warn.mock.calls)).not.toContain('wamid.1')
    warn.mockRestore()
  })
})
