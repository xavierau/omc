import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/infrastructure/supabase/client', () => ({
  createServerSupabaseClient: vi.fn(),
}))

vi.mock('@/infrastructure/supabase/repositories/consent-record-repository', () => ({
  insertConsentRecord: vi.fn(),
}))

vi.mock('@/application/emit-event', () => ({
  emitEvent: vi.fn().mockResolvedValue('event-id'),
}))

import { createServerSupabaseClient } from '@/infrastructure/supabase/client'
import { insertConsentRecord } from '@/infrastructure/supabase/repositories/consent-record-repository'
import { emitEvent } from '@/application/emit-event'
import { ConsentImportError } from '@/domain/repositories/consent-record-repository'
import { importOneContactRow } from '../import-contacts-batch-row'

beforeEach(() => vi.clearAllMocks())

interface MemberRecorder {
  inserted: Array<Record<string, unknown>>
  selected: Array<{ col: string; val: unknown }>
}

interface ClientOpts {
  insertResult?: { id: string } | null
  insertError?: { message: string; code?: string } | null
  existingMember?: { id: string } | null
}

function buildClient(opts: ClientOpts = {}): {
  client: ReturnType<typeof createServerSupabaseClient>
  rec: MemberRecorder
} {
  const rec: MemberRecorder = { inserted: [], selected: [] }
  const insertSingle = vi.fn().mockResolvedValue({
    data: opts.insertResult ?? { id: 'new-mem' },
    error: opts.insertError ?? null,
  })
  const insertSelect = vi.fn().mockReturnValue({ single: insertSingle })
  const insertFn = vi.fn().mockImplementation((row: Record<string, unknown>) => {
    rec.inserted.push(row)
    return { select: insertSelect }
  })
  // SELECT chain for the existing-member lookup (merge=true).
  const selectMaybeSingle = vi.fn().mockResolvedValue({
    data: opts.existingMember ?? null,
    error: null,
  })
  const selectChain: Record<string, unknown> = { maybeSingle: selectMaybeSingle }
  selectChain.eq = vi.fn().mockImplementation((col: string, val: unknown) => {
    rec.selected.push({ col, val })
    return selectChain
  })
  const select = vi.fn().mockReturnValue({
    eq: (col: string, val: unknown) => {
      rec.selected.push({ col, val })
      return selectChain
    },
  })
  const from = vi.fn().mockReturnValue({ insert: insertFn, select })
  return {
    client: { from } as unknown as ReturnType<typeof createServerSupabaseClient>,
    rec,
  }
}

const META = {
  source: 'paper-list-2026-Q1',
  consentChannel: 'generic' as const,
  consentTextShown: 'I agree to receive marketing messages from Demo Cafe.',
  proofUrl: null,
  importBatchId: '11111111-1111-1111-1111-111111111111',
  capturedAt: new Date('2026-01-31T00:00:00.000Z'),
}

describe('importOneContactRow', () => {
  it('inserts member + consent_record + emits consent_imported (merge=false, new phone)', async () => {
    const { client, rec } = buildClient()
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)
    vi.mocked(insertConsentRecord).mockResolvedValue(undefined)

    const outcome = await importOneContactRow({
      restaurantId: 'rest-1',
      mergeExistingMembers: false,
      grade: 'medium',
      meta: META,
      row: { phoneE164: '+85291234567', name: 'Alice', preferredLanguage: 'en' },
    })

    expect(outcome.ok).toBe(true)
    expect(rec.inserted).toHaveLength(1)
    expect(rec.inserted[0]).toMatchObject({
      restaurant_id: 'rest-1',
      phone: '+85291234567',
      name: 'Alice',
    })
    const consentArg = vi.mocked(insertConsentRecord).mock.calls[0][0]
    expect(consentArg.snapshot).toMatchObject({
      restaurantId: 'rest-1',
      phoneE164: '+85291234567',
      consentGrade: 'medium',
      consentTextShown: META.consentTextShown,
      proofUrl: null,
    })
    expect(emitEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'consent_imported',
        restaurantId: 'rest-1',
        dataJson: expect.objectContaining({
          importBatchId: META.importBatchId,
          grade: 'medium',
          channel: 'generic',
          source: META.source,
        }),
      })
    )
    if (outcome.ok) {
      expect(outcome.gradeBucket).toBe('medium')
      expect(outcome.created).toBe(true) // B3: brand new member insert
    }
  })

  it('rejects with phone_already_member when merge=false and the phone exists', async () => {
    const { client } = buildClient({
      insertError: { message: 'duplicate', code: '23505' },
    })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    const outcome = await importOneContactRow({
      restaurantId: 'rest-1',
      mergeExistingMembers: false,
      grade: 'weak',
      meta: META,
      row: { phoneE164: '+85291234567', name: null, preferredLanguage: null },
    })

    expect(outcome.ok).toBe(false)
    if (!outcome.ok) {
      expect(outcome.reject.reason).toBe('phone_already_member')
    }
    expect(insertConsentRecord).not.toHaveBeenCalled()
    expect(emitEvent).not.toHaveBeenCalled()
  })

  it('skips member insert when merge=true and phone already exists; still writes consent', async () => {
    const { client, rec } = buildClient({
      existingMember: { id: 'mem-existing' },
    })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)
    vi.mocked(insertConsentRecord).mockResolvedValue(undefined)

    const outcome = await importOneContactRow({
      restaurantId: 'rest-1',
      mergeExistingMembers: true,
      grade: 'strong',
      meta: META,
      row: { phoneE164: '+85291234567', name: null, preferredLanguage: null },
    })

    expect(outcome.ok).toBe(true)
    expect(rec.inserted).toHaveLength(0)         // no member insert
    const consentArg = vi.mocked(insertConsentRecord).mock.calls[0][0]
    expect(consentArg.snapshot.memberId).toBe('mem-existing')
    if (outcome.ok) expect(outcome.created).toBe(false) // B3: existing member
  })

  it('threads meta.importBatchId onto the persisted consent_record (B1)', async () => {
    const { client } = buildClient()
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)
    vi.mocked(insertConsentRecord).mockResolvedValue(undefined)

    await importOneContactRow({
      restaurantId: 'rest-1',
      mergeExistingMembers: false,
      grade: 'medium',
      meta: META,
      row: { phoneE164: '+85291234567', name: null, preferredLanguage: null },
    })

    const consentArg = vi.mocked(insertConsentRecord).mock.calls[0][0]
    expect(consentArg.snapshot.importBatchId).toBe(META.importBatchId)
  })

  it('reports duplicate_active when consent insert hits the partial unique index', async () => {
    const { client } = buildClient({
      existingMember: { id: 'mem-x' },
    })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)
    vi.mocked(insertConsentRecord).mockRejectedValue(
      new ConsentImportError('duplicate_active', 'already opted in')
    )

    const outcome = await importOneContactRow({
      restaurantId: 'rest-1',
      mergeExistingMembers: true,
      grade: 'weak',
      meta: META,
      row: { phoneE164: '+85291234567', name: null, preferredLanguage: null },
    })

    expect(outcome.ok).toBe(false)
    if (!outcome.ok) {
      expect(outcome.reject.reason).toBe('duplicate_active')
    }
  })
})
