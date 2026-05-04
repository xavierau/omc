import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/infrastructure/supabase/client', () => ({
  createServerSupabaseClient: vi.fn(),
}))

vi.mock('@/infrastructure/supabase/repositories/consent-record-repository', () => ({
  insertConsentRecord: vi.fn(),
}))

import { createServerSupabaseClient } from '@/infrastructure/supabase/client'
import { insertConsentRecord } from '@/infrastructure/supabase/repositories/consent-record-repository'
import { importMembersWithConsent } from '../import-members-with-consent'
import { ConsentImportError } from '@/domain/repositories/consent-record-repository'

interface MemberInsertRecorder {
  inserted: Array<Record<string, unknown>>
}

function buildClient(opts: {
  insertResult?: { id: string } | null
  insertError?: { message: string; code?: string } | null
} = {}): {
  client: ReturnType<typeof createServerSupabaseClient>
  recorder: MemberInsertRecorder
} {
  const recorder: MemberInsertRecorder = { inserted: [] }
  const single = vi.fn().mockResolvedValue({
    data: opts.insertResult ?? { id: 'new-member-id' },
    error: opts.insertError ?? null,
  })
  const select = vi.fn().mockReturnValue({ single })
  const insert = vi.fn().mockImplementation((row: Record<string, unknown>) => {
    recorder.inserted.push(row)
    return { select }
  })
  const from = vi.fn().mockReturnValue({ insert })
  return {
    client: { from } as unknown as ReturnType<typeof createServerSupabaseClient>,
    recorder,
  }
}

describe('importMembersWithConsent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('imports a row with member + consent_record', async () => {
    const { client, recorder } = buildClient({ insertResult: { id: 'mem-new' } })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)
    vi.mocked(insertConsentRecord).mockResolvedValue(undefined)

    const result = await importMembersWithConsent({
      restaurantId: 'r-1',
      rows: [
        {
          phoneE164: '85291234567',
          name: 'Alice',
          consent: {
            source: 'csv_import',
            sourceReference: 'members-2026-05.csv',
            grade: 'strong',
            businessNameShown: 'Demo Cafe',
          },
        },
      ],
    })

    expect(result.imported).toBe(1)
    expect(result.rejected).toEqual([])
    expect(recorder.inserted[0]).toMatchObject({
      restaurant_id: 'r-1',
      phone: '85291234567',
      name: 'Alice',
      status: 'active',
    })
    expect(insertConsentRecord).toHaveBeenCalledTimes(1)
    const consentArg = vi.mocked(insertConsentRecord).mock.calls[0][0]
    expect(consentArg.snapshot).toMatchObject({
      restaurantId: 'r-1',
      memberId: 'mem-new',
      phoneE164: '85291234567',
      category: 'marketing',
      status: 'opted_in',
      consentGrade: 'strong',
      source: 'csv_import',
      sourceReference: 'members-2026-05.csv',
      businessNameShown: 'Demo Cafe',
    })
  })

  it('rejects rows missing consent.source — never inserts member or consent', async () => {
    const { client, recorder } = buildClient()
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)

    const result = await importMembersWithConsent({
      restaurantId: 'r-1',
      rows: [
        {
          phoneE164: '85291234567',
          consent: { source: '' },
        },
        {
          phoneE164: '85299999999',
          consent: { source: '   ' },
        },
      ],
    })

    expect(result.imported).toBe(0)
    expect(result.rejected).toHaveLength(2)
    expect(result.rejected[0].reason).toBe('missing_consent_source')
    expect(result.rejected[1].reason).toBe('missing_consent_source')
    expect(recorder.inserted).toHaveLength(0)
    expect(insertConsentRecord).not.toHaveBeenCalled()
  })

  it('partial failure — bad rows reported, good rows still imported', async () => {
    const { client } = buildClient({ insertResult: { id: 'mem-good' } })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)
    vi.mocked(insertConsentRecord).mockResolvedValue(undefined)

    const result = await importMembersWithConsent({
      restaurantId: 'r-1',
      rows: [
        { phoneE164: '85291234567', consent: { source: 'csv_import' } },
        { phoneE164: '85299999999', consent: { source: '' } },
        { phoneE164: '85288888888', consent: { source: 'csv_import' } },
      ],
    })

    expect(result.imported).toBe(2)
    expect(result.rejected).toHaveLength(1)
    expect(result.rejected[0].reason).toBe('missing_consent_source')
  })

  it('reports duplicate_active when consent already exists', async () => {
    const { client } = buildClient({ insertResult: { id: 'mem-dup' } })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)
    vi.mocked(insertConsentRecord).mockRejectedValue(
      new ConsentImportError('duplicate_active', 'already opted in')
    )

    const result = await importMembersWithConsent({
      restaurantId: 'r-1',
      rows: [{ phoneE164: '85291234567', consent: { source: 'csv_import' } }],
    })

    expect(result.imported).toBe(0)
    expect(result.rejected).toHaveLength(1)
    expect(result.rejected[0].reason).toBe('duplicate_active')
  })

  it('defaults grade to strong when not provided', async () => {
    const { client } = buildClient({ insertResult: { id: 'mem-x' } })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)
    vi.mocked(insertConsentRecord).mockResolvedValue(undefined)

    await importMembersWithConsent({
      restaurantId: 'r-1',
      rows: [{ phoneE164: '85291234567', consent: { source: 'csv_import' } }],
    })

    const consentArg = vi.mocked(insertConsentRecord).mock.calls[0][0]
    expect(consentArg.snapshot.consentGrade).toBe('strong')
  })

  it('does NOT throw on partial failure — returns the summary', async () => {
    const { client } = buildClient({ insertResult: { id: 'mem-y' } })
    vi.mocked(createServerSupabaseClient).mockReturnValue(client)
    vi.mocked(insertConsentRecord)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(
        new ConsentImportError('duplicate_active', 'dup')
      )

    const result = await importMembersWithConsent({
      restaurantId: 'r-1',
      rows: [
        { phoneE164: '85291234567', consent: { source: 'csv_import' } },
        { phoneE164: '85299999999', consent: { source: 'csv_import' } },
      ],
    })

    expect(result.imported).toBe(1)
    expect(result.rejected).toHaveLength(1)
  })
})
