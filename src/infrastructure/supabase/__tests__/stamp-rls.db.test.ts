/**
 * DB INTEGRATION TESTS for migration 052 (stamp RLS).
 *
 * ⚠️  REQUIRES THE MIGRATION-APPLY RPC TEST RIG (plan §10, Slice-1 subtask 1).
 *     Same authored-but-gated convention as platform-settings.db.test.ts and
 *     stamp-rpc.db.test.ts: gated behind `RUN_DB_TESTS=1` so `npm test` stays
 *     green without a database.
 *
 * HOW TO RUN once the rig lands:
 *   RUN_DB_TESTS=1 npx vitest run \
 *     src/infrastructure/supabase/__tests__/stamp-rls.db.test.ts
 *
 * Covers the REL-001 vulnerability fix: migration 050 created
 * stamp_campaigns / member_stamp_cards without RLS, leaving both
 * cross-tenant readable and writable via PostgREST with the anon key.
 *   - anon SELECT on both tables returns no rows (RLS deny-by-default)
 *   - anon INSERT is rejected (no write policy exists)
 *   - anon UPDATE affects zero rows (invisible rows can't be targeted)
 *   - the service-role client (the app's sole access path) still bypasses RLS
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const RUN = process.env.RUN_DB_TESTS === '1'
const d = RUN ? describe : describe.skip

let anon: SupabaseClient
let service: SupabaseClient

beforeAll(() => {
  if (!RUN) return
  anon = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
  service = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
})

d('stamp tables — RLS enforcement (migration 052)', () => {
  it('anon client reads zero rows from stamp_campaigns', async () => {
    const { data, error } = await anon.from('stamp_campaigns').select('id')
    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it('anon client reads zero rows from member_stamp_cards', async () => {
    const { data, error } = await anon.from('member_stamp_cards').select('id')
    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it('anon client cannot INSERT into stamp_campaigns (no write policy)', async () => {
    const { error } = await anon.from('stamp_campaigns').insert({
      restaurant_id: '00000000-0000-0000-0000-000000000000',
      name: 'rls-probe',
      stamps_required: 5,
    })
    expect(error).not.toBeNull()
  })

  it('anon client UPDATE on member_stamp_cards affects zero rows', async () => {
    const { count, error } = await anon
      .from('member_stamp_cards')
      .update({ status: 'completed' }, { count: 'exact' })
      .neq('id', '00000000-0000-0000-0000-000000000000')
    expect(error).toBeNull()
    expect(count ?? 0).toBe(0)
  })

  it('service-role client (the only app access path) still bypasses RLS', async () => {
    const { error } = await service.from('stamp_campaigns').select('id')
    expect(error).toBeNull()
  })
})
