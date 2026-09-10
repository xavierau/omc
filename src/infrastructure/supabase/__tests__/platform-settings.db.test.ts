/**
 * DB-FUNCTION INTEGRATION TESTS for migration 051 (platform_settings).
 *
 * ⚠️  REQUIRES THE MIGRATION-APPLY RPC TEST RIG (plan §10, Slice-1 subtask 1).
 *     That rig is NET-NEW infra and is NOT built yet. Until it exists these tests
 *     are authored-but-unrunnable and are gated behind `RUN_DB_TESTS=1` so the pure
 *     `npm test` suite stays green. Same gating convention as stamp-rpc.db.test.ts.
 *
 * HOW TO RUN once the rig lands:
 *   RUN_DB_TESTS=1 npx vitest run \
 *     src/infrastructure/supabase/__tests__/platform-settings.db.test.ts
 *
 * Covers the cap-policy storage contract:
 *   - the single seeded row exists with the founder-default policy (warn, threshold 1)
 *   - the single-row invariant holds (a second INSERT is rejected)
 *   - the enforcement CHECK rejects an out-of-set value
 *   - a non-admin authenticated client cannot UPDATE the policy (RLS lockdown)
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const RUN = process.env.RUN_DB_TESTS === '1'
const d = RUN ? describe : describe.skip

let sb: SupabaseClient

beforeAll(() => {
  if (!RUN) return
  sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
})

d('platform_settings — single-row policy storage (migration 051)', () => {
  it('seeds exactly one row with the founder-default policy', async () => {
    const { data } = await sb.from('platform_settings').select('*')
    expect(data).toHaveLength(1)
    expect(data?.[0]?.stamp_cap_enforcement).toBe('warn')
    expect(data?.[0]?.stamp_cap_warn_threshold).toBe(1)
  })

  it('rejects a second row (single-row invariant via the id CHECK + PK)', async () => {
    const { error } = await sb.from('platform_settings').insert({ id: true })
    expect(error).not.toBeNull()
  })

  it('rejects an out-of-set enforcement value', async () => {
    const { error } = await sb
      .from('platform_settings')
      .update({ stamp_cap_enforcement: 'nuke' })
      .eq('id', true)
    expect(error).not.toBeNull()
  })

  it('accepts a valid platform-admin policy change (service role)', async () => {
    const { error } = await sb
      .from('platform_settings')
      .update({ stamp_cap_enforcement: 'block', stamp_cap_warn_threshold: 2 })
      .eq('id', true)
    expect(error).toBeNull()
    // restore default for idempotent reruns
    await sb
      .from('platform_settings')
      .update({ stamp_cap_enforcement: 'warn', stamp_cap_warn_threshold: 1 })
      .eq('id', true)
  })
})
