import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/infrastructure/supabase/client', () => ({
  createServerSupabaseClient: vi.fn(),
}))

import { createServerSupabaseClient } from '@/infrastructure/supabase/client'
import { resolveMemberId } from '../import-contacts-batch-row-member'

beforeEach(() => vi.clearAllMocks())

interface ClientOpts {
  insertResult?: { id: string } | null
  insertError?: { message: string; code?: string } | null
  existingMember?: { id: string } | null
}

function buildClient(opts: ClientOpts = {}): ReturnType<typeof createServerSupabaseClient> {
  const insertSingle = vi.fn().mockResolvedValue({
    data: opts.insertResult ?? { id: 'new-mem' },
    error: opts.insertError ?? null,
  })
  const insertSelect = vi.fn().mockReturnValue({ single: insertSingle })
  const insertFn = vi.fn().mockReturnValue({ select: insertSelect })
  const selectMaybeSingle = vi.fn().mockResolvedValue({
    data: opts.existingMember ?? null,
    error: null,
  })
  const selectChain: Record<string, unknown> = { maybeSingle: selectMaybeSingle }
  selectChain.eq = vi.fn().mockReturnValue(selectChain)
  const select = vi.fn().mockReturnValue({
    eq: () => selectChain,
  })
  const from = vi.fn().mockReturnValue({ insert: insertFn, select })
  return { from } as unknown as ReturnType<typeof createServerSupabaseClient>
}

// WI-18: a STATEFUL `members` table fake, keyed on (restaurant_id, phone) --
// unlike `buildClient` above (which always answers a fixed, per-test-configured
// result), this one actually tracks what's "in the DB" across MULTIPLE
// `resolveMemberId` calls against the SAME client instance, so a test can
// prove "create once, then re-import" without hand-wiring each call's mock
// response. Mirrors `idx_members_restaurant_phone`'s real unique-index
// behaviour (23505 on a colliding insert) and `insertMember`'s real re-select
// (member-create-repository.ts) -- both are exercised for real here, not
// stubbed away, since the seam's own 23505-reselect fallback is EXACTLY the
// mechanism that (per investigation, see this WI's artifact) already masks
// the pre-check bug from the CALLER's point of view -- an outcome-only
// assertion would stay green with or without the fix. `insertAttempts`
// exposes the one signal that DOES distinguish them: whether the merge-mode
// re-import ever reached the seam's INSERT at all. Every other table (e.g.
// `integration_events`, touched by the seam's best-effort publish on a
// `created` outcome) gets the same always-succeeds, never-configured shape
// `buildClient` above uses -- this fake only needs to be smart about
// `members`.
function buildStatefulMembersClient(): {
  client: ReturnType<typeof createServerSupabaseClient>
  insertAttempts: () => number
} {
  const rows = new Map<string, { id: string; status: 'active' | 'unsubscribed' }>()
  let seq = 0
  let insertCalls = 0

  function genericTable() {
    const single = vi.fn().mockResolvedValue({ data: { id: 'evt-stub' }, error: null })
    const insertSelect = vi.fn().mockReturnValue({ single })
    const insertFn = vi.fn().mockReturnValue({ select: insertSelect })
    const chain: Record<string, unknown> = {
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    }
    chain.eq = vi.fn().mockReturnValue(chain)
    const select = vi.fn().mockReturnValue(chain)
    return { insert: insertFn, select }
  }

  function membersTable() {
    return {
      insert: (payload: { restaurant_id: string; phone: string }) => {
        insertCalls += 1
        return {
          select: () => ({
            single: async () => {
              const key = `${payload.restaurant_id}:${payload.phone}`
              if (rows.has(key)) {
                return {
                  data: null,
                  error: {
                    code: '23505',
                    message:
                      'duplicate key value violates unique constraint "idx_members_restaurant_phone"',
                  },
                }
              }
              const id = `mem-${++seq}`
              rows.set(key, { id, status: 'active' })
              return { data: { id, status: 'active' }, error: null }
            },
          }),
        }
      },
      select: () => {
        let restaurantId: string | undefined
        let phone: string | undefined
        const chain = {
          eq: (col: string, val: string) => {
            if (col === 'restaurant_id') restaurantId = val
            if (col === 'phone') phone = val
            return chain
          },
          maybeSingle: async () => {
            const row = rows.get(`${restaurantId}:${phone}`)
            return { data: row ? { id: row.id, status: row.status } : null, error: null }
          },
        }
        return chain
      },
    }
  }

  const from = vi.fn((table: string) => (table === 'members' ? membersTable() : genericTable()))
  return {
    client: { from } as unknown as ReturnType<typeof createServerSupabaseClient>,
    insertAttempts: () => insertCalls,
  }
}

describe('resolveMemberId — created flag (B3)', () => {
  it('returns created=true on a fresh insert (merge=false, new phone)', async () => {
    vi.mocked(createServerSupabaseClient).mockReturnValue(
      buildClient({ insertResult: { id: 'mem-new' } })
    )

    const out = await resolveMemberId({
      restaurantId: 'rest-1',
      mergeExistingMembers: false,
      row: { phoneE164: '+85291234567', name: null, preferredLanguage: null },
    })

    expect(out.ok).toBe(true)
    if (out.ok) {
      expect(out.id).toBe('mem-new')
      expect(out.created).toBe(true)
    }
  })

  it('returns created=false when merge=true picks up an existing member', async () => {
    vi.mocked(createServerSupabaseClient).mockReturnValue(
      buildClient({ existingMember: { id: 'mem-existing' } })
    )

    const out = await resolveMemberId({
      restaurantId: 'rest-1',
      mergeExistingMembers: true,
      row: { phoneE164: '+85291234567', name: null, preferredLanguage: null },
    })

    expect(out.ok).toBe(true)
    if (out.ok) {
      expect(out.id).toBe('mem-existing')
      expect(out.created).toBe(false)
    }
  })

  it('returns created=true when merge=true but no existing member (insert path)', async () => {
    vi.mocked(createServerSupabaseClient).mockReturnValue(
      buildClient({ existingMember: null, insertResult: { id: 'mem-new-2' } })
    )

    const out = await resolveMemberId({
      restaurantId: 'rest-1',
      mergeExistingMembers: true,
      row: { phoneE164: '+85291234567', name: null, preferredLanguage: null },
    })

    expect(out.ok).toBe(true)
    if (out.ok) {
      expect(out.id).toBe('mem-new-2')
      expect(out.created).toBe(true)
    }
  })
})

// N-8 (WI-17 confirmation review, G-3 gap 1): `row.phoneE164` is
// `PhoneNumber.create(raw).value` -- the LEGACY, non-strict grammar (dots,
// leading-zero digit runs tolerated), not already a valid E.164. Before this
// fix, a bare `E164Phone.of(row.phoneE164)` threw for any legacy-accepted
// format, landed in the generic catch, and was misclassified as
// `duplicate_active` -- the row was rejected as if it were a DB conflict
// when it was never imported at all.
describe('resolveMemberId — N-8: legacy-accepted phone formats route through the SAME fallback the WhatsApp/web join paths use', () => {
  it('a dotted phone format is imported via the fallback (created=true), NOT rejected as duplicate_active', async () => {
    vi.mocked(createServerSupabaseClient).mockReturnValue(
      buildClient({ insertResult: { id: 'mem-dotted' } })
    )

    const out = await resolveMemberId({
      restaurantId: 'rest-1',
      mergeExistingMembers: false,
      // PhoneNumber.create('+852.9123.4567').value keeps the dots.
      row: { phoneE164: '+852.9123.4567', name: null, preferredLanguage: null },
    })

    expect(out.ok).toBe(true)
    if (out.ok) {
      expect(out.id).toBe('mem-dotted')
      expect(out.created).toBe(true)
    }
  })

  it('a genuinely unresolvable phone (letter-noised digit run) rejects with reason invalid_phone, never duplicate_active', async () => {
    vi.mocked(createServerSupabaseClient).mockReturnValue(buildClient({}))

    const out = await resolveMemberId({
      restaurantId: 'rest-1',
      mergeExistingMembers: false,
      // PhoneNumber.create('98x765432').value: 9 digits, within [8,15], but
      // the embedded letter defeats both E164Phone.of and parseE164Phone.
      row: { phoneE164: '98x765432', name: null, preferredLanguage: null },
    })

    expect(out.ok).toBe(false)
    if (!out.ok) {
      expect(out.reject.reason).toBe('invalid_phone')
      expect(out.reject.reason).not.toBe('duplicate_active')
    }
  })

  it('a clean E.164 phone still resolves via the strict path (no behaviour change for the common case)', async () => {
    vi.mocked(createServerSupabaseClient).mockReturnValue(
      buildClient({ insertResult: { id: 'mem-clean' } })
    )

    const out = await resolveMemberId({
      restaurantId: 'rest-1',
      mergeExistingMembers: false,
      row: { phoneE164: '+85291234567', name: null, preferredLanguage: null },
    })

    expect(out.ok).toBe(true)
    if (out.ok) expect(out.id).toBe('mem-clean')
  })
})

// WI-18 (INT-001 WI-17 confirmation-review hand-off, "Deferred" section): a
// merge-mode re-import of a legacy-format phone that was previously
// IMPORTED via the N-8 fallback (i.e. now normalised in the DB) used to hit
// `findMemberId` with the same un-repaired raw `row.phoneE164`
// (`resolveMemberId`'s own `mergeExistingMembers` branch, above
// `createViaSeam`) -- the SAME class of bug N-9 fixed for
// `register-member.ts`/`register-member-web.ts`'s pre-checks.
describe('resolveMemberId — WI-18: merge-mode pre-check normalises legacy phone formats before querying', () => {
  it('a legacy-format phone imported once (create), then re-imported in merge mode with the SAME raw format, resolves to exactly one member via the pre-check itself (no insert attempt on the re-import)', async () => {
    const { client, insertAttempts } = buildStatefulMembersClient()
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    // PhoneNumber.create('+852.9123.4567').value keeps the dots -- the same
    // legacy-accepted format the N-8 fallback (resolveLegacyMemberE164)
    // normalises to '+85291234567' before it ever reaches the DB.
    const row = { phoneE164: '+852.9123.4567', name: 'Alice', preferredLanguage: null as null }

    const first = await resolveMemberId({
      restaurantId: 'rest-1',
      mergeExistingMembers: false,
      row,
    })
    expect(first.ok).toBe(true)
    if (!first.ok) return
    expect(first.created).toBe(true)
    const memberId = first.id
    expect(insertAttempts()).toBe(1)

    const second = await resolveMemberId({
      restaurantId: 'rest-1',
      mergeExistingMembers: true,
      row,
    })
    expect(second.ok).toBe(true)
    if (!second.ok) return
    expect(second.created).toBe(false)
    expect(second.id).toBe(memberId)

    // The actual bug: with the raw-phone SELECT, `findMemberId` MISSES the
    // normalised row (the pre-check's own query never matches what's
    // stored), so `resolveMemberId` falls through to `createViaSeam` and
    // attempts a SECOND insert -- which the seam's 23505-reselect happens
    // to catch and paper over, but only by coincidence of the DB's unique
    // index existing. The pre-check must find the row DIRECTLY: exactly one
    // insert attempt total, ever, for this phone.
    expect(insertAttempts()).toBe(1)
  })
})

// WI-18: existing CSV create-mode duplicate rejection must be unaffected --
// this fix only touches the `mergeExistingMembers === true` pre-check.
describe('resolveMemberId — WI-18 regression: create-mode duplicate rejection is untouched', () => {
  it('a true duplicate phone (create mode, merge=false) is still rejected, never merged', async () => {
    const { client } = buildStatefulMembersClient()
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    const row = { phoneE164: '+85291234567', name: 'Bob', preferredLanguage: null as null }
    const first = await resolveMemberId({ restaurantId: 'rest-1', mergeExistingMembers: false, row })
    expect(first.ok).toBe(true)

    const second = await resolveMemberId({ restaurantId: 'rest-1', mergeExistingMembers: false, row })
    expect(second.ok).toBe(false)
    if (!second.ok) expect(second.reject.reason).toBe('phone_already_member')
  })
})
