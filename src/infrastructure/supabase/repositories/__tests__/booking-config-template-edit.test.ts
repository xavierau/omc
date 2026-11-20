// BOOK-002 F1 C2: every booking_config writer is a compare-and-swap on the
// stored revision (`booking_config.rev`). It re-reads the row, applies its own
// change to that fresh value, and writes only while the revision is still the
// one it read; a lost race retries on the new value. The query SHAPE is
// asserted here; the semantics run against real PostgREST in
// booking-config-cas.postgrest.test.ts.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { recordingSupabase, filtersOf, type RecordedQuery } from '@/test-utils/recording-supabase'

vi.mock('@/infrastructure/supabase/client', () => ({ createServerSupabaseClient: vi.fn() }))

import { createServerSupabaseClient } from '@/infrastructure/supabase/client'
import {
  promoteBookingTemplateCandidate,
  saveBookingSettings,
  saveBookingTemplateEdit,
  saveProvisionedBookingTemplates,
} from '../booking-config-repository'
import { DEFAULT_BOOKING_CONFIG } from '@/domain/value-objects/booking-config'

const RID = 'rest-1'
const STORED = {
  mode: 'simple',
  rev: 3,
  templateIds: { confirmed: { en: 'tpl-old', zh_hk: null } },
  templateCandidates: { confirmed: { en: 'tpl-new' } },
  templateBodies: { confirmed: { en: 'Custom {{date}} at {{time}} ok.' } },
}

type Written = Record<string, unknown> & {
  rev: number
  mode: string
  maxPartySize: number
  templateIds: Record<string, Record<string, unknown>>
  templateCandidates: Record<string, Record<string, unknown>>
  templateBodies: Record<string, Record<string, unknown>>
}

function use(results: Parameters<typeof recordingSupabase>[0]) {
  const rec = recordingSupabase(results)
  vi.mocked(createServerSupabaseClient).mockReturnValue(rec.client as never)
  return rec
}

const read = (config: unknown) => ({ data: { booking_config: config } })
const won = { data: [{ id: RID }] }
const lost = { data: [] }
const updates = (queries: RecordedQuery[]) => queries.filter((q) => q.calls.some(([m]) => m === 'update'))
const written = (q: RecordedQuery) => (q.calls.find(([m]) => m === 'update')?.[1] as { booking_config: Written }).booking_config

beforeEach(() => vi.clearAllMocks())

describe('the compare-and-swap write', () => {
  it('guards on the revision it read and bumps it', async () => {
    const rec = use([read(STORED), won])
    await saveBookingTemplateEdit(RID, { kind: 'confirmed', language: 'zh_hk', body: '新{{date}} {{time}}。', candidateId: 'tpl-zh', promotedId: null })
    const [update] = updates(rec.queries)
    expect(filtersOf(update)).toEqual([`eq:id=${RID}`, 'eq:booking_config->>rev=3'])
    expect(update.calls.some(([m, cols]) => m === 'select' && cols === 'id')).toBe(true)
    expect(written(update).rev).toBe(4)
  })

  it('a row written before revisions existed is guarded on rev being absent', async () => {
    const legacy = { ...STORED, rev: undefined }
    const rec = use([read(legacy), won])
    await saveBookingTemplateEdit(RID, { kind: 'confirmed', language: 'en', body: null, candidateId: null, promotedId: null })
    const [update] = updates(rec.queries)
    expect(filtersOf(update)).toEqual([`eq:id=${RID}`, 'is:booking_config->>rev=null'])
    expect(written(update).rev).toBe(1)
  })

  it('a lost race re-reads and re-applies the change to the fresh value', async () => {
    const fresh = { ...STORED, rev: 4, mode: 'external', maxPartySize: 9 }
    const rec = use([read(STORED), lost, read(fresh), won])
    await saveBookingTemplateEdit(RID, { kind: 'confirmed', language: 'zh_hk', body: '新{{date}} {{time}}。', candidateId: 'tpl-zh', promotedId: null })
    const [, second] = updates(rec.queries)
    expect(filtersOf(second)).toEqual([`eq:id=${RID}`, 'eq:booking_config->>rev=4'])
    const config = written(second)
    expect(config.mode).toBe('external')
    expect(config.maxPartySize).toBe(9)
    expect(config.templateCandidates.confirmed).toEqual({ en: 'tpl-new', zh_hk: 'tpl-zh' })
    expect(config.rev).toBe(5)
  })

  it('gives up with an error after 5 lost races', async () => {
    use((q) => (q.calls.some(([m]) => m === 'update') ? lost : read(STORED)))
    await expect(
      saveBookingTemplateEdit(RID, { kind: 'confirmed', language: 'en', body: null, candidateId: null, promotedId: null })
    ).rejects.toThrow(/changed concurrently/)
  })

  it('throws when the write fails', async () => {
    use([read(STORED), { error: { message: 'boom' } }])
    await expect(
      saveBookingTemplateEdit(RID, { kind: 'confirmed', language: 'en', body: null, candidateId: null, promotedId: null })
    ).rejects.toThrow(/boom/)
  })
})

describe('promoteBookingTemplateCandidate', () => {
  it('moves the candidate into templateIds and keeps the custom text', async () => {
    const rec = use([read(STORED), won])
    expect(await promoteBookingTemplateCandidate(RID, 'confirmed', 'en', 'tpl-new')).toBe(true)
    const config = written(updates(rec.queries)[0])
    expect(config.templateIds.confirmed.en).toBe('tpl-new')
    expect(config.templateCandidates.confirmed.en).toBeUndefined()
    expect(config.templateBodies.confirmed.en).toBe('Custom {{date}} at {{time}} ok.')
  })

  it('a lost race whose winner already promoted reports false and writes once', async () => {
    const promoted = { ...STORED, rev: 4, templateIds: { confirmed: { en: 'tpl-new', zh_hk: null } }, templateCandidates: {} }
    const rec = use([read(STORED), lost, read(promoted)])
    expect(await promoteBookingTemplateCandidate(RID, 'confirmed', 'en', 'tpl-new')).toBe(false)
    expect(updates(rec.queries)).toHaveLength(1)
  })

  it('does not write when the stored candidate is already another id', async () => {
    const rec = use([read(STORED)])
    expect(await promoteBookingTemplateCandidate(RID, 'confirmed', 'en', 'tpl-other')).toBe(false)
    expect(rec.queries).toHaveLength(1)
  })
})

describe('saveBookingSettings (the settings PUT)', () => {
  it('writes only the settings fields onto the fresh config, never stale template ids', async () => {
    const rec = use([read({ ...STORED, maxPartySize: 12 }), won])
    const stale = structuredClone({ ...DEFAULT_BOOKING_CONFIG, mode: 'off' as const, maxPartySize: 30 })
    await saveBookingSettings(RID, stale)
    const config = written(updates(rec.queries)[0])
    expect(config.mode).toBe('off')
    expect(config.maxPartySize).toBe(30)
    expect(config.templateIds.confirmed.en).toBe('tpl-old')
    expect(config.templateCandidates.confirmed.en).toBe('tpl-new')
    expect(config.templateBodies.confirmed.en).toBe('Custom {{date}} at {{time}} ok.')
  })
})

describe('saveProvisionedBookingTemplates', () => {
  it('sets only the submitted slots and clears their stale candidate', async () => {
    const rec = use([read(STORED), won])
    await saveProvisionedBookingTemplates(RID, [{ kind: 'confirmed', language: 'en', id: 'tpl-live-2', staleCandidateId: 'tpl-new' }])
    const config = written(updates(rec.queries)[0])
    expect(config.templateIds.confirmed).toEqual({ en: 'tpl-live-2', zh_hk: null })
    expect(config.templateCandidates.confirmed.en).toBeUndefined()
  })
})
