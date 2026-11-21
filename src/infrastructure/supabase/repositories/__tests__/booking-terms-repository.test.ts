// BOOK-009 AC-10 (migration 091): accepted terms are written on insert only
// when set (so other inserts don't depend on 091), and staff lists read them.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { recordingSupabase } from '@/test-utils/recording-supabase'

vi.mock('@/infrastructure/supabase/client', () => ({ createServerSupabaseClient: vi.fn() }))

import { createServerSupabaseClient } from '@/infrastructure/supabase/client'
import { insertBookingRequest, STAFF_COLUMNS, toBookingRequest } from '../booking-request-repository'

const ROW = {
  id: 'b-1', restaurant_id: 'r-a', member_id: null, phone: '+852', name: 'Chan', party_size: 4,
  booking_date: '2026-11-13', booking_time: '19:30:00', notes: null, status: 'pending' as const, decline_reason: null,
  decided_by: null, decided_at: null, source: 'chat' as const, campaign_id: null, created_at: '2026-11-12T10:00:00Z',
  decision_message_status: null,
}
const NEW = {
  restaurantId: 'r-a', memberId: null, phone: '+852', name: 'Chan', partySize: 4, bookingDate: '2026-11-13',
  bookingTime: '19:30', notes: null, source: 'chat' as const, campaignId: null, token: 'tok',
}

function use(results: Parameters<typeof recordingSupabase>[0]) {
  const rec = recordingSupabase(results)
  vi.mocked(createServerSupabaseClient).mockReturnValue(rec.client as never)
  return rec
}
const inserted = (rec: ReturnType<typeof use>) => rec.queries[0].calls[0][1] as Record<string, unknown>

beforeEach(() => vi.clearAllMocks())

describe('booking terms acceptance in the repository', () => {
  it('writes terms_accepted_at and terms_text when the diner accepted terms', async () => {
    const rec = use([{ data: ROW }])
    await insertBookingRequest({ ...NEW, termsAcceptedAt: '2026-11-12T02:00:00.000Z', termsText: 'Be on time' })
    expect(inserted(rec)).toMatchObject({ terms_accepted_at: '2026-11-12T02:00:00.000Z', terms_text: 'Be on time' })
  })

  it('writes neither column otherwise', async () => {
    const rec = use([{ data: ROW }])
    await insertBookingRequest(NEW)
    expect(inserted(rec)).not.toHaveProperty('terms_accepted_at')
    expect(inserted(rec)).not.toHaveProperty('terms_text')
  })

  it('staff lists select both columns and map them', () => {
    expect(STAFF_COLUMNS).toContain('terms_accepted_at')
    expect(STAFF_COLUMNS).toContain('terms_text')
    expect(toBookingRequest({ ...ROW, terms_accepted_at: '2026-11-12T02:00:00Z', terms_text: 'x' })).toMatchObject({
      termsAcceptedAt: '2026-11-12T02:00:00Z',
      termsText: 'x',
    })
    expect(toBookingRequest(ROW)).not.toHaveProperty('termsAcceptedAt')
  })
})
