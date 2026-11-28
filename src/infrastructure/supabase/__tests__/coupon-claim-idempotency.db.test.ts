/**
 * DB INTEGRATION TESTS for migration 053 (CAMP-001 claim idempotency index).
 *
 * ⚠️  REQUIRES THE MIGRATION-APPLY RPC TEST RIG (same authored-but-gated
 *     convention as stamp-rls.db.test.ts / stamp-rpc.db.test.ts). Gated behind
 *     `RUN_DB_TESTS=1` with `describe.skip` so the pure `npm test` suite stays
 *     green without a database.
 *
 * HOW TO RUN once the rig lands:
 *   1. Apply migrations 001..053 to a seeded test schema.
 *   2. export NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
 *   3. RUN_DB_TESTS=1 npx vitest run \
 *        src/infrastructure/supabase/__tests__/coupon-claim-idempotency.db.test.ts
 *
 * Covers the partial UNIQUE index `uniq_coupon_campaign_member`, which is the
 * DB-side guarantee behind the double-tap race handling in
 * application/claim-campaign-coupon.ts:
 *   - a second `promo` coupon for the same (campaign_id, member_id) is rejected
 *     with SQLSTATE 23505 (the app catches this and re-fetches the winner)
 *   - the partial predicate does NOT constrain non-promo coupons, nor promo
 *     coupons with a null campaign_id (welcome / reward / shared rows)
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const RUN = process.env.RUN_DB_TESTS === '1'
const d = RUN ? describe : describe.skip

// Stable test fixtures (restaurant / member / campaign seeded by the rig).
const REST = 'aaaaaaaa-0000-0000-0000-000000000001'
const MEMBER = '22222222-0000-0000-0000-000000000001'
const CAMPAIGN = '33333333-0000-0000-0000-000000000001'

let sb: SupabaseClient

beforeAll(() => {
  if (!RUN) return
  sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
})

afterEach(async () => {
  if (!RUN) return
  await sb.from('coupons').delete().eq('campaign_id', CAMPAIGN).eq('member_id', MEMBER)
})

function insertPromoCoupon(code: string, campaignId: string | null = CAMPAIGN) {
  return sb.from('coupons').insert({
    restaurant_id: REST,
    type: 'promo',
    code,
    status: 'active',
    member_id: MEMBER,
    campaign_id: campaignId,
    is_active: true,
    max_uses: 1,
  })
}

d('coupons — claim idempotency index (migration 053)', () => {
  it('a second promo coupon for the same (campaign, member) is rejected with 23505', async () => {
    const first = await insertPromoCoupon('CLAIMDB01')
    expect(first.error).toBeNull()

    const second = await insertPromoCoupon('CLAIMDB02')
    expect(second.error).not.toBeNull()
    expect(second.error?.code).toBe('23505')
  })

  it('does NOT constrain a promo coupon with a null campaign_id (partial predicate)', async () => {
    const first = await insertPromoCoupon('CLAIMDB03')
    expect(first.error).toBeNull()

    // Same member, no campaign → outside the partial index → allowed.
    const second = await insertPromoCoupon('CLAIMDB04', null)
    expect(second.error).toBeNull()

    await sb.from('coupons').delete().eq('code', 'CLAIMDB04')
  })

  it('does NOT constrain a non-promo coupon for the same (campaign, member)', async () => {
    const first = await insertPromoCoupon('CLAIMDB05')
    expect(first.error).toBeNull()

    const reward = await sb.from('coupons').insert({
      restaurant_id: REST,
      type: 'reward',
      code: 'CLAIMDB06',
      status: 'active',
      member_id: MEMBER,
      campaign_id: CAMPAIGN,
      is_active: true,
      max_uses: 1,
    })
    expect(reward.error).toBeNull()

    await sb.from('coupons').delete().eq('code', 'CLAIMDB06')
  })
})
