// BOOK-002: custom bodies and candidates are written onto the CURRENT stored
// booking_config, and promotion is a conditional write on the candidate id so
// concurrent sends promote once (B2-03).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { recordingSupabase, filtersOf } from '@/test-utils/recording-supabase'

vi.mock('@/infrastructure/supabase/client', () => ({ createServerSupabaseClient: vi.fn() }))

import { createServerSupabaseClient } from '@/infrastructure/supabase/client'
import { promoteBookingTemplateCandidate, saveBookingTemplateEdit } from '../booking-config-repository'

const RID = 'rest-1'
const STORED = {
  mode: 'simple',
  templateIds: { confirmed: { en: 'tpl-old', zh_hk: null } },
  templateCandidates: { confirmed: { en: 'tpl-new' } },
  templateBodies: { confirmed: { en: 'Custom {{date}} at {{time}} ok.' } },
}

function use(results: Parameters<typeof recordingSupabase>[0]) {
  const rec = recordingSupabase(results)
  vi.mocked(createServerSupabaseClient).mockReturnValue(rec.client as never)
  return rec
}

const written = (call: unknown[] | undefined) => (call?.[1] as { booking_config: Record<string, Record<string, Record<string, unknown>>> }).booking_config

beforeEach(() => vi.clearAllMocks())

describe('promoteBookingTemplateCandidate', () => {
  it('moves the candidate into templateIds, guarded by the stored candidate id', async () => {
    const rec = use([{ data: { booking_config: STORED } }, { data: [{ id: RID }] }])
    expect(await promoteBookingTemplateCandidate(RID, 'confirmed', 'en', 'tpl-new')).toBe(true)
    const update = rec.queries[1]
    expect(filtersOf(update)).toEqual([`eq:id=${RID}`, 'eq:booking_config->templateCandidates->confirmed->>en=tpl-new'])
    const config = written(update.calls.find(([m]) => m === 'update'))
    expect(config.templateIds.confirmed.en).toBe('tpl-new')
    expect(config.templateCandidates.confirmed.en).toBeUndefined()
    expect(config.templateBodies.confirmed.en).toBe('Custom {{date}} at {{time}} ok.')
  })

  it('a lost race (no row matched the guard) reports false', async () => {
    use([{ data: { booking_config: STORED } }, { data: [] }])
    expect(await promoteBookingTemplateCandidate(RID, 'confirmed', 'en', 'tpl-new')).toBe(false)
  })

  it('does not write when the stored candidate is already another id', async () => {
    const rec = use([{ data: { booking_config: STORED } }])
    expect(await promoteBookingTemplateCandidate(RID, 'confirmed', 'en', 'tpl-other')).toBe(false)
    expect(rec.queries).toHaveLength(1)
  })
})

describe('saveBookingTemplateEdit', () => {
  it('writes the body and candidate onto the current config, keeping the rest', async () => {
    const rec = use([{ data: { booking_config: { ...STORED, maxPartySize: 12 } } }, { error: null }])
    await saveBookingTemplateEdit(RID, { kind: 'confirmed', language: 'zh_hk', body: '新文字{{date}} {{time}}。', candidateId: 'tpl-zh', promotedId: null })
    const config = written(rec.queries[1].calls.find(([m]) => m === 'update')) as unknown as Record<string, unknown> & typeof STORED
    expect((config as unknown as { maxPartySize: number }).maxPartySize).toBe(12)
    expect(config.templateBodies.confirmed).toEqual({ en: 'Custom {{date}} at {{time}} ok.', zh_hk: '新文字{{date}} {{time}}。' })
    expect(config.templateCandidates.confirmed).toEqual({ en: 'tpl-new', zh_hk: 'tpl-zh' })
    expect(filtersOf(rec.queries[1])).toEqual([`eq:id=${RID}`])
  })

  it('throws when the write fails', async () => {
    use([{ data: { booking_config: STORED } }, { error: { message: 'boom' } }])
    await expect(
      saveBookingTemplateEdit(RID, { kind: 'confirmed', language: 'en', body: null, candidateId: null, promotedId: null })
    ).rejects.toThrow(/boom/)
  })
})
