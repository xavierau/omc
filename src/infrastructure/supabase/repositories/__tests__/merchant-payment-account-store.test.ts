// BOOK-014 W6-fix F6: an account event's status write is ordered by the
// provider's event time. The query shape is asserted here; the PostgREST
// filter itself runs against a real PostgREST in
// src/infrastructure/supabase/__tests__/merchant-account-order-postgrest.db.test.ts.
import { describe, it, expect, vi } from 'vitest'
import { filtersOf, recordingSupabase } from '@/test-utils/recording-supabase'

vi.mock('@/infrastructure/supabase/client', () => ({ createServerSupabaseClient: vi.fn() }))

import { createServerSupabaseClient } from '@/infrastructure/supabase/client'
import { merchantPaymentAccountStore } from '../merchant-payment-account-store'

const ROW = {
  id: 'a-1', restaurant_id: 'r-a', provider_code: 'stripe', provider_account_id: 'acct_1', status: 'active', charges_enabled: true,
  currency: 'HKD', restriction_reason: null, updated_at: 'u',
}
const UPDATE = { status: 'active' as const, chargesEnabled: true, detailsSubmitted: true, currency: 'HKD', restrictionReason: null }

function store() {
  const rec = recordingSupabase([{ data: ROW }])
  vi.mocked(createServerSupabaseClient).mockReturnValue(rec.client as never)
  return rec
}

describe('merchantPaymentAccountStore.applyStatus (W6-fix F6)', () => {
  it('F6 with eventAt: writes last_webhook_at and only where it is unset or not newer', async () => {
    const rec = store()
    const eventAt = new Date('2026-11-28T10:00:05Z')
    await merchantPaymentAccountStore.applyStatus({ accountId: 'a-1', providerAccountId: 'acct_1', update: UPDATE, at: new Date('2026-11-28T10:00:09Z'), eventAt })
    const update = rec.queries[0].calls.find(([m]) => m === 'update')?.[1] as Record<string, unknown>
    expect(update).toMatchObject({ last_webhook_at: '2026-11-28T10:00:05.000Z', status: 'active' })
    expect(filtersOf(rec.queries[0])).toEqual([
      'eq:id=a-1', 'eq:provider_account_id=acct_1', 'or:last_webhook_at.is.null,last_webhook_at.lte.2026-11-28T10:00:05.000Z',
    ])
  })

  it('without eventAt (the return-page refresh, a deauthorization): no ordering, last_webhook_at untouched', async () => {
    const rec = store()
    await merchantPaymentAccountStore.applyStatus({ accountId: 'a-1', providerAccountId: 'acct_1', update: UPDATE, at: new Date() })
    const update = rec.queries[0].calls.find(([m]) => m === 'update')?.[1] as Record<string, unknown>
    expect(update).not.toHaveProperty('last_webhook_at')
    expect(filtersOf(rec.queries[0])).toEqual(['eq:id=a-1', 'eq:provider_account_id=acct_1'])
  })
})
