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
