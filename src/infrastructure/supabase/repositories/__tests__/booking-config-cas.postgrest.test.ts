/**
 * BOOK-002 F1 C2 — booking_config writers under real concurrency, against a
 * real PostgREST + Postgres (not the recording fake).
 *
 * Every writer re-reads booking_config, applies its own change and writes
 * with a compare-and-swap on `booking_config->>rev`, retrying on a lost race,
 * so concurrent writers to different fields never erase each other.
 *
 * Gated behind `RUN_POSTGREST_TESTS=1`. `POSTGREST_URL` names a PostgREST
 * whose anon role may write a `restaurants(id uuid, booking_config jsonb)`
 * table (scratch stack: supabase/postgres 17.6 + postgrest v14.14, recorded in
 * .claude-workspace/artifacts/2026-11-13-book-002-f1-handoff.md). The
 * repository's Supabase client is replaced by a PostgrestClient on that URL:
 * the same query builder supabase-js uses for `.from()`.
 *
 *   RUN_POSTGREST_TESTS=1 POSTGREST_URL=http://127.0.0.1:15891 \
 *     npx vitest run src/infrastructure/supabase/repositories/__tests__/booking-config-cas.postgrest.test.ts
 */
import { describe, it, expect, vi, beforeAll } from 'vitest'
import { PostgrestClient } from '@supabase/postgrest-js'

const RUN = process.env.RUN_POSTGREST_TESTS === '1'
const d = RUN ? describe : describe.skip
const POSTGREST = process.env.POSTGREST_URL ?? 'http://127.0.0.1:15891'

vi.mock('@/infrastructure/supabase/client', () => ({ createServerSupabaseClient: vi.fn() }))

import { createServerSupabaseClient } from '@/infrastructure/supabase/client'
import {
  getBookingConfig,
  promoteBookingTemplateCandidate,
  saveBookingSettings,
  saveBookingTemplateEdit,
  saveProvisionedBookingTemplates,
} from '../booking-config-repository'
import { DEFAULT_BOOKING_CONFIG } from '@/domain/value-objects/booking-config'

// Counts PATCH requests, so a test can show races really happened (a lost
// compare-and-swap is a PATCH that matched no row, then a retry).
let patches = 0
const countingFetch: typeof fetch = (input, init) => {
  if (init?.method === 'PATCH') patches++
  return fetch(input, init)
}
const db = () => new PostgrestClient(POSTGREST, { fetch: countingFetch })
const ROUNDS = 12

async function restaurant(config: Record<string, unknown>): Promise<string> {
  const { data, error } = await db().from('restaurants').insert({ booking_config: config }).select('id').single()
  if (error) throw new Error(error.message)
  return (data as { id: string }).id
}

async function raw(id: string): Promise<Record<string, unknown>> {
  const { data } = await db().from('restaurants').select('booking_config').eq('id', id).single()
  return (data as { booking_config: Record<string, unknown> }).booking_config
}

const seed = () => ({
  mode: 'simple',
  templateIds: { ...DEFAULT_BOOKING_CONFIG.templateIds, confirmed: { en: 'tpl-old', zh_hk: null } },
  templateCandidates: { received: {}, confirmed: { en: 'tpl-new' }, declined: {}, reminder: {} },
  templateBodies: { received: {}, confirmed: { en: 'Custom {{date}} at {{time}} ok.' }, declined: {}, reminder: {} },
})

d('booking_config compare-and-swap on real PostgREST', () => {
  beforeAll(() => {
    vi.mocked(createServerSupabaseClient).mockImplementation(() => db() as never)
  })

  it('promotion racing a settings save (mode change): both survive, every round', async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const id = await restaurant(seed())
      const config = await getBookingConfig(id)
      const [promoted] = await Promise.all([
        promoteBookingTemplateCandidate(id, 'confirmed', 'en', 'tpl-new'),
        saveBookingSettings(id, { ...config, mode: 'external', externalUrl: 'https://inline.app/x' }),
      ])
      const after = await getBookingConfig(id)
      expect(promoted, `round ${round}`).toBe(true)
      expect(after.templateIds.confirmed.en, `round ${round}`).toBe('tpl-new')
      expect(after.templateCandidates.confirmed.en, `round ${round}`).toBeUndefined()
      expect(after.mode, `round ${round}`).toBe('external')
    }
  })

  it('two slot edits at once: both survive, every round', async () => {
    patches = 0
    for (let round = 0; round < ROUNDS; round++) {
      const id = await restaurant(seed())
      await Promise.all([
        saveBookingTemplateEdit(id, { kind: 'declined', language: 'zh_hk', body: '抱歉{{date}} {{time}}', candidateId: 'cand-d', promotedId: null }),
        saveBookingTemplateEdit(id, { kind: 'reminder', language: 'en', body: 'See you {{date}} {{time}} ok', candidateId: 'cand-r', promotedId: null }),
      ])
      const after = await getBookingConfig(id)
      expect(after.templateCandidates.declined.zh_hk, `round ${round}`).toBe('cand-d')
      expect(after.templateCandidates.reminder.en, `round ${round}`).toBe('cand-r')
      expect(after.templateBodies.confirmed.en, `round ${round}`).toBe('Custom {{date}} at {{time}} ok.')
    }
    // More PATCHes than writers: some rounds raced, lost the swap and retried.
    console.info(`[cas] two slot edits: ${patches} PATCHes for ${2 * ROUNDS} writes`)
    expect(patches).toBeGreaterThan(2 * ROUNDS)
  })

  it('provisioning racing a promotion of another slot: both survive', async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const id = await restaurant(seed())
      await Promise.all([
        promoteBookingTemplateCandidate(id, 'confirmed', 'en', 'tpl-new'),
        saveProvisionedBookingTemplates(id, [{ kind: 'declined', language: 'en', id: 'tpl-declined-2', staleCandidateId: null }]),
      ])
      const after = await getBookingConfig(id)
      expect(after.templateIds.confirmed.en, `round ${round}`).toBe('tpl-new')
      expect(after.templateIds.declined.en, `round ${round}`).toBe('tpl-declined-2')
    }
  })

  it('eight concurrent promotions of one candidate: exactly one reports the write', async () => {
    const id = await restaurant(seed())
    const results = await Promise.all(Array.from({ length: 8 }, () => promoteBookingTemplateCandidate(id, 'confirmed', 'en', 'tpl-new')))
    expect(results.filter(Boolean)).toHaveLength(1)
    expect((await getBookingConfig(id)).templateIds.confirmed.en).toBe('tpl-new')
  })

  it('a row with no rev (written before F1) is taken over: the first write stores rev 1', async () => {
    const id = await restaurant(seed())
    expect((await raw(id)).rev).toBeUndefined()
    await saveBookingTemplateEdit(id, { kind: 'reminder', language: 'en', body: null, candidateId: null, promotedId: null })
    expect((await raw(id)).rev).toBe(1)
    await promoteBookingTemplateCandidate(id, 'confirmed', 'en', 'tpl-new')
    expect((await raw(id)).rev).toBe(2)
  })
})
