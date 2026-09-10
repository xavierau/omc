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
