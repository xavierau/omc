// BOOK-001 W2-07 (AC-7, R17): the classification row and its duplicate path.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { recordingSupabase } from '@/test-utils/recording-supabase'

vi.mock('@/infrastructure/supabase/client', () => ({ createServerSupabaseClient: vi.fn() }))

import { createServerSupabaseClient } from '@/infrastructure/supabase/client'
import { recordInboundClassification } from '../inbound-classification-repository'

const ROW = { restaurantId: 'r1', messageId: 'wamid.1', label: 'booking' as const, confidence: 0.8, outcome: 'booking_reply' as const }

function useResult(result: { error?: { message: string; code?: string } | null }) {
  const db = recordingSupabase([result])
  vi.mocked(createServerSupabaseClient).mockReturnValue(db.client as never)
  return db
}

describe('recordInboundClassification', () => {
  beforeEach(() => vi.clearAllMocks())

  it('inserts label, confidence, outcome and message id; no text column', async () => {
    const db = useResult({ error: null })
    expect(await recordInboundClassification(ROW)).toBe('recorded')
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

  it('a replayed wamid (23505) → duplicate, no throw', async () => {
    useResult({ error: { message: 'duplicate key value violates unique constraint', code: '23505' } })
    expect(await recordInboundClassification(ROW)).toBe('duplicate')
  })

  it('any other error or a throw → failed, never throws', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    useResult({ error: { message: 'boom wamid.1', code: '42501' } })
    expect(await recordInboundClassification(ROW)).toBe('failed')
    vi.mocked(createServerSupabaseClient).mockImplementation(() => { throw new Error('no env') })
    expect(await recordInboundClassification(ROW)).toBe('failed')
    expect(JSON.stringify(warn.mock.calls)).not.toContain('wamid.1')
    warn.mockRestore()
  })
})
