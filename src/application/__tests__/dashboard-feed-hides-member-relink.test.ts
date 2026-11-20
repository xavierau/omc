// BOOK-008 r1 F4 (/code-review PR #214): a manual booking ↔ member relink
// writes a 'booking.member_relinked' events row as the audit trail (R4). It is
// staff bookkeeping, not member activity, so the dashboard activity feeds
// never show it: the MiniFeed (overview recentEvents) and /dashboard/feed (the
// events API, also its poll) filter it out IN the query, so the limit still
// returns that many feed rows. The row itself stays in the events table.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { recordingSupabase, filtersOf } from '@/test-utils/recording-supabase'
import { BOOKING_MEMBER_RELINKED_EVENT } from '@/domain/entities/member-booking'

vi.mock('@/infrastructure/supabase/client', () => ({ createServerSupabaseClient: vi.fn() }))

import { createServerSupabaseClient } from '@/infrastructure/supabase/client'
import { getDashboardOverview } from '../get-dashboard-overview'
import { getEvents } from '@/infrastructure/supabase/repositories/event-repository'

const EVENT = { id: 'e-1', type: 'join', data_json: {}, created_at: '2026-11-20T00:00:00Z', members: { name: 'Test Member' } }

function use() {
  const rec = recordingSupabase((q) => (q.table === 'events' ? { data: [EVENT] } : { data: [], count: 0 }))
  vi.mocked(createServerSupabaseClient).mockReturnValue(rec.client as never)
  return rec
}

const eventsQuery = (rec: ReturnType<typeof use>) => {
  const q = rec.queries.filter((x) => x.table === 'events')
  expect(q).toHaveLength(1)
  return q[0]
}

beforeEach(() => vi.clearAllMocks())

describe('activity feeds never show booking.member_relinked (r1 F4)', () => {
  it('MiniFeed: the overview recentEvents query excludes it, scoped by restaurant, before the limit', async () => {
    const rec = use()
    const overview = await getDashboardOverview('rest-a')
    const q = eventsQuery(rec)
    expect(filtersOf(q)).toEqual(['eq:restaurant_id=rest-a', `neq:type=${BOOKING_MEMBER_RELINKED_EVENT}`])
    expect(q.calls.at(-1)).toEqual(['limit', 10])
    expect(overview.recentEvents.map((e) => e.id)).toEqual(['e-1'])
  })

  it('/dashboard/feed: the events API query excludes it, with and without a type filter', async () => {
    let rec = use()
    await getEvents({ restaurantId: 'rest-a', limit: 50 })
    expect(filtersOf(eventsQuery(rec))).toEqual(['eq:restaurant_id=rest-a', `neq:type=${BOOKING_MEMBER_RELINKED_EVENT}`])
    rec = use()
    await getEvents({ restaurantId: 'rest-a', limit: 50, type: 'join' })
    expect(filtersOf(eventsQuery(rec))).toEqual([
      'eq:restaurant_id=rest-a',
      `neq:type=${BOOKING_MEMBER_RELINKED_EVENT}`,
      'eq:type=join',
    ])
  })
})
