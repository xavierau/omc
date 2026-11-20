// AGENT-005 AC-2: 訂座規則 (bookingRules) saves through the booking settings
// PUT and its rev compare-and-swap, onto the session's own restaurant only.
// The real repository runs here; only the Supabase client is recorded.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { recordingSupabase, filtersOf, type RecordedQuery } from '@/test-utils/recording-supabase'

vi.mock('@/infrastructure/supabase/guards/tenant-guard')
vi.mock('@/infrastructure/supabase/client', () => ({ createServerSupabaseClient: vi.fn() }))
vi.mock('@/application/booking/booking-template-deps', () => ({
  bookingTemplateOverviewFor: vi.fn(),
  bookingTemplateStatusesFor: vi.fn(async () => null),
  provisionBookingTemplatesFor: vi.fn(async () => null),
}))

import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { createServerSupabaseClient } from '@/infrastructure/supabase/client'
import { BOOKING_RULES_MAX_CHARS } from '@/domain/value-objects/booking-config'
import { PUT } from '../route'

const RID = 'rest-1'
const RULES = 'Bookings 12:00-20:00. Last order 20:30.'
const STORED = { mode: 'external', externalUrl: 'https://book.example/x', rev: 7, aiRoutingEnabled: true }

function req(body: unknown) {
  return new NextRequest('http://localhost/api/dashboard/settings/booking', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const read = (config: unknown) => ({ data: { booking_config: config } })
const updates = (queries: RecordedQuery[]) => queries.filter((q) => q.calls.some(([m]) => m === 'update'))
const written = (q: RecordedQuery) =>
  (q.calls.find(([m]) => m === 'update')?.[1] as { booking_config: Record<string, unknown> }).booking_config

function use(results: Parameters<typeof recordingSupabase>[0]) {
  const rec = recordingSupabase(results)
  vi.mocked(createServerSupabaseClient).mockReturnValue(rec.client as never)
  return rec
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getTenantContext).mockResolvedValue({ userId: 'u-1', restaurantId: RID, role: 'admin', tenantStatus: 'active' })
})

describe('PUT booking settings with bookingRules (AGENT-005 AC-2)', () => {
  it('saves the trimmed rules with the rev guard, scoped to the session tenant, keeping fields the form does not own', async () => {
    const rec = use([read(STORED), read(STORED), { data: [{ id: RID }] }])
    const res = await PUT(req({ mode: 'external', externalUrl: STORED.externalUrl, bookingRules: `  ${RULES}\n` }))
    expect(res.status).toBe(200)
    expect((await res.json()).config.bookingRules).toBe(RULES)
    const [update] = updates(rec.queries)
    expect(filtersOf(update)).toEqual([`eq:id=${RID}`, 'eq:booking_config->>rev=7'])
    expect(written(update)).toMatchObject({ bookingRules: RULES, rev: 8, aiRoutingEnabled: true, mode: 'external' })
  })

  it('a lost race re-reads and re-applies the rules onto the newer stored value', async () => {
    const newer = { ...STORED, rev: 8, templateIds: { received: { en: 'tpl-1', zh_hk: null } } }
    const rec = use([read(STORED), read(STORED), { data: [] }, read(newer), { data: [{ id: RID }] }])
    expect((await PUT(req({ mode: 'external', externalUrl: STORED.externalUrl, bookingRules: RULES }))).status).toBe(200)
    const [, second] = updates(rec.queries)
    expect(filtersOf(second)).toContain('eq:booking_config->>rev=8')
    expect(written(second)).toMatchObject({ bookingRules: RULES, rev: 9 })
    expect((written(second).templateIds as Record<string, unknown>).received).toEqual({ en: 'tpl-1', zh_hk: null })
  })

  it(`more than ${BOOKING_RULES_MAX_CHARS} characters → 400 with a bookingRules field error, nothing written`, async () => {
    const rec = use([read(STORED)])
    const res = await PUT(req({ mode: 'external', externalUrl: STORED.externalUrl, bookingRules: 'x'.repeat(BOOKING_RULES_MAX_CHARS + 1) }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'invalid', fields: { bookingRules: 'too_long' } })
    expect(updates(rec.queries)).toHaveLength(0)
  })

  it('a stored config without the key reads as empty rules and a save without the field keeps it empty', async () => {
    const rec = use([read(STORED), read(STORED), { data: [{ id: RID }] }])
    expect((await PUT(req({ mode: 'off' }))).status).toBe(200)
    expect(written(updates(rec.queries)[0]).bookingRules).toBe('')
  })

  it('a body naming another restaurant is refused; every query is scoped to the session tenant', async () => {
    const rec = use([read(STORED)])
    expect((await PUT(req({ mode: 'off', bookingRules: RULES, restaurantId: 'other' }))).status).toBe(400)
    expect(updates(rec.queries)).toHaveLength(0)
    expect(rec.queries.every((q) => filtersOf(q).includes(`eq:id=${RID}`))).toBe(true)
  })
})
