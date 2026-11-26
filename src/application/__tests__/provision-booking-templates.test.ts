// BOOK-001 W3-05 (AC-1 templates): turning on Simple booking submits the
// booking UTILITY templates (six kinds since BOOK-013) in zh_HK and en with per-attempt names, stores
// their ids, and is idempotent: re-saving submits nothing new, a rejected or
// failed one is resubmitted.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { provisionBookingTemplates, type ProvisionBookingTemplatesDeps } from '../booking/provision-booking-templates'
import { DEFAULT_BOOKING_CONFIG, type BookingConfig } from '@/domain/value-objects/booking-config'
import { buildWhatsAppTemplate } from '@/test-utils/builders'
import { applyProvisionedTemplates } from '@/domain/services/booking-template-slot'
import type { TemplateStatus, WhatsAppTemplate } from '@/domain/entities/whatsapp-template'

const RID = 'rest-a'
const SAMPLE_QR = 'https://storage.example/booking-checkin-qr/examples/checkin-qr-example.png'

let rows: Map<string, WhatsAppTemplate>
let config: BookingConfig
let deps: { [K in keyof ProvisionBookingTemplatesDeps]: ReturnType<typeof vi.fn> }
let seq: number

function createdAs(status: TemplateStatus) {
  deps.createTemplate.mockImplementation(async (p) => {
    const t = buildWhatsAppTemplate({ id: `t${++seq}`, restaurantId: RID, name: p.name, language: p.language, category: p.category, status, components: p.components })
    rows.set(t.id, t)
    return { template: t }
  })
}

beforeEach(() => {
  rows = new Map()
  seq = 0
  config = { ...DEFAULT_BOOKING_CONFIG, mode: 'simple' }
  let suffix = 0
  deps = {
    getConfig: vi.fn(async () => config),
    findTemplates: vi.fn(async (ids: string[]) => ids.map((id) => rows.get(id)).filter(Boolean)),
    createTemplate: vi.fn(),
    resubmitTemplate: vi.fn(async (id: string) => ({ template: rows.get(id) })),
    saveProvisioned: vi.fn(async (_rid, slots) => { config = applyProvisionedTemplates(config, slots) }),
    ensureWabaId: vi.fn(async () => 'waba-1'),
    suffix: vi.fn(() => `s${++suffix}`),
    qrExampleUrl: vi.fn(async () => SAMPLE_QR),
  }
  createdAs('pending')
})

const provision = () => provisionBookingTemplates(RID, deps as unknown as ProvisionBookingTemplatesDeps)

describe('provisionBookingTemplates', () => {
  it('submits 6 kinds × 2 languages as UTILITY with minted unique names and stores their ids', async () => {
    const statuses = await provision()
    expect(deps.createTemplate).toHaveBeenCalledTimes(12)
    const calls = deps.createTemplate.mock.calls.map((c) => c[0])
    expect(new Set(calls.map((c) => c.category))).toEqual(new Set(['UTILITY']))
    expect(new Set(calls.map((c) => c.restaurantId))).toEqual(new Set([RID]))
    expect(new Set(calls.map((c) => `${c.name}/${c.language}`)).size).toBe(12)
    expect(new Set(calls.map((c) => c.language))).toEqual(new Set(['en', 'zh_HK']))
    for (const kind of ['received', 'confirmed', 'declined', 'reminder', 'changed', 'cancelled']) {
      expect(calls.filter((c) => c.name.startsWith(`booking_${kind}_`))).toHaveLength(2)
    }
    expect(deps.saveProvisioned).toHaveBeenCalledTimes(1)
    const slots = deps.saveProvisioned.mock.calls[0][1] as Array<{ id: string | null }>
    expect(slots).toHaveLength(12)
    expect(slots.every((slot) => typeof slot.id === 'string')).toBe(true)
    expect(statuses.received).toEqual({ en: 'pending', zh_hk: 'pending' })
  })

  it('re-saving submits nothing new', async () => {
    await provision()
    deps.createTemplate.mockClear()
    const statuses = await provision()
    expect(deps.createTemplate).not.toHaveBeenCalled()
    expect(statuses.reminder).toEqual({ en: 'pending', zh_hk: 'pending' })
  })

  it('resubmits a rejected template under a new name and keeps the rest', async () => {
    await provision()
    const rejectedId = config.templateIds.declined.en as string
    rows.set(rejectedId, { ...(rows.get(rejectedId) as WhatsAppTemplate), status: 'rejected' })
    deps.createTemplate.mockClear()
    await provision()
    expect(deps.createTemplate).toHaveBeenCalledTimes(1)
    const call = deps.createTemplate.mock.calls[0][0]
    expect(call).toMatchObject({ language: 'en', category: 'UTILITY' })
    expect(call.name).toMatch(/^booking_declined_/)
    expect(call.name).not.toBe(rows.get(rejectedId)?.name)
    expect(config.templateIds.declined.en).not.toBe(rejectedId)
    expect(config.templateIds.declined.zh_hk).toBeTruthy()
  })

  it('a submission failure (draft row, provider error) shows as failed and is resubmitted next save', async () => {
    deps.createTemplate.mockImplementation(async (p) => {
      const t = buildWhatsAppTemplate({ id: `t${++seq}`, restaurantId: RID, name: p.name, language: p.language, status: 'draft' })
      rows.set(t.id, t)
      return { template: t, error: 'Failed to submit template to Meta', errorCode: 'provider_error' }
    })
    const statuses = await provision()
    expect(statuses.confirmed).toEqual({ en: 'failed', zh_hk: 'failed' })
    deps.createTemplate.mockClear()
    // F12: the failed drafts are resubmitted in place, not created again.
    deps.resubmitTemplate.mockImplementation(async (id: string) => {
      const t = { ...(rows.get(id) as WhatsAppTemplate), status: 'pending' as const }
      rows.set(id, t)
      return { template: t }
    })
    expect((await provision()).confirmed).toEqual({ en: 'pending', zh_hk: 'pending' })
    expect(deps.createTemplate).not.toHaveBeenCalled()
    expect(deps.resubmitTemplate).toHaveBeenCalledTimes(12)
  })

  // F12 (review S-5): with the provider down, each Simple save used to leave
  // more draft rows in the restaurant's template list (12 per save since BOOK-013).
  it('three saves with the provider failing leave 12 rows, not 36: a failed draft is resubmitted in place', async () => {
    deps.createTemplate.mockImplementation(async (p) => {
      const t = buildWhatsAppTemplate({ id: `t${++seq}`, restaurantId: RID, name: p.name, language: p.language, status: 'draft' })
      rows.set(t.id, t)
      return { template: t, error: 'Failed to submit template to Meta', errorCode: 'provider_error' }
    })
    await provision()
    await provision()
    const statuses = await provision()
    expect(rows.size).toBe(12)
    expect(deps.createTemplate).toHaveBeenCalledTimes(12)
    expect(deps.resubmitTemplate).toHaveBeenCalledTimes(24)
    expect(new Set(deps.resubmitTemplate.mock.calls.map((c) => c[1]))).toEqual(new Set([RID]))
    expect(statuses.reminder).toEqual({ en: 'failed', zh_hk: 'failed' })
  })

  it('a resubmitted draft that reaches Meta keeps its id and reads pending', async () => {
    deps.createTemplate.mockImplementation(async (p) => {
      const t = buildWhatsAppTemplate({ id: `t${++seq}`, restaurantId: RID, name: p.name, language: p.language, status: 'draft' })
      rows.set(t.id, t)
      return { template: t }
    })
    await provision()
    const draftId = config.templateIds.received.en as string
    deps.resubmitTemplate.mockImplementation(async (id: string) => {
      const t = { ...(rows.get(id) as WhatsAppTemplate), status: 'pending' as const }
      rows.set(id, t)
      return { template: t }
    })
    const statuses = await provision()
    expect(config.templateIds.received.en).toBe(draftId)
    expect(statuses.received.en).toBe('pending')
    expect(rows.size).toBe(12)
  })

  it('a create that throws records not_submitted for that template and still saves the others', async () => {
    deps.createTemplate.mockImplementation(async (p) => {
      if (p.language === 'en') throw new Error('db down')
      const t = buildWhatsAppTemplate({ id: `t${++seq}`, name: p.name, language: p.language, status: 'pending' })
      rows.set(t.id, t)
      return { template: t }
    })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const statuses = await provision()
    expect(statuses.received).toEqual({ en: 'not_submitted', zh_hk: 'pending' })
    expect(deps.saveProvisioned).toHaveBeenCalledTimes(1)
  })

  it('looks templates up scoped to the restaurant', async () => {
    await provision()
    await provision()
    expect(deps.findTemplates.mock.calls.every((c) => c[1] === RID)).toBe(true)
  })
})

// BOOK-002 B2-04: a Simple save resubmits a missing or rejected kind with the
// restaurant's own text when it has one.
describe('provisionBookingTemplates with custom text (BOOK-002)', () => {
  const CUSTOM = 'Sorry, we cannot seat you on {{date}} at {{time}}. Reason: {{reason}}. Please pick another time with us.'
  const bodyOf = (call: unknown[]) => (call[0] as { components: Array<{ text: string }> }).components[0].text

  const withCustom = () => {
    config = structuredClone(config)
    config.templateBodies.declined.en = CUSTOM
  }

  it('a missing kind is submitted with the custom body, the other language with the default', async () => {
    withCustom()
    await provision()
    const declined = deps.createTemplate.mock.calls.filter((c) => c[0].name.startsWith('booking_declined_'))
    expect(declined.find((c) => c[0].language === 'en')?.[0].components).toEqual([{ type: 'BODY', text: CUSTOM }])
    expect(bodyOf(declined.find((c) => c[0].language === 'zh_HK') as unknown[])).toContain('很抱歉')
  })

  it('a rejected kind is resubmitted with the custom body', async () => {
    await provision()
    const rejectedId = config.templateIds.declined.en as string
    rows.set(rejectedId, { ...(rows.get(rejectedId) as WhatsAppTemplate), status: 'rejected' })
    withCustom()
    deps.createTemplate.mockClear()
    await provision()
    expect(deps.createTemplate).toHaveBeenCalledTimes(1)
    expect(bodyOf(deps.createTemplate.mock.calls[0])).toBe(CUSTOM)
  })

  it('a failed draft is resubmitted in place with the custom body', async () => {
    createdAs('draft')
    await provision()
    withCustom()
    createdAs('pending')
    deps.resubmitTemplate.mockClear()
    await provision()
    const call = deps.resubmitTemplate.mock.calls.find((c) => c[0] === config.templateIds.declined.en)
    expect(call?.[2]).toEqual([{ type: 'BODY', text: CUSTOM }])
  })

  it('leaves a slot alone while its edit is pending at Meta, and counts an approved edit as live', async () => {
    await provision()
    for (const id of [config.templateIds.declined.en, config.templateIds.reminder.en] as string[]) {
      rows.set(id, { ...(rows.get(id) as WhatsAppTemplate), status: 'rejected' })
    }
    rows.set('cand-p', buildWhatsAppTemplate({ id: 'cand-p', status: 'pending' }))
    rows.set('cand-a', buildWhatsAppTemplate({ id: 'cand-a', status: 'approved' }))
    config = structuredClone(config)
    config.templateCandidates.declined.en = 'cand-p'
    config.templateCandidates.reminder.en = 'cand-a'
    deps.createTemplate.mockClear()
    const statuses = await provision()
    expect(deps.createTemplate).not.toHaveBeenCalled()
    expect(statuses.reminder.en).toBe('approved')
  })
})

// BOOK-002 F1 C7 and C2: provisioning writes only the slots it submitted, and
// a slot it gives a new live template loses its rejected or failed edit.
describe('provisionBookingTemplates and stale edits (BOOK-002 F1)', () => {
  async function liveRejectedWithCandidate(candidateStatus: TemplateStatus) {
    await provision()
    const liveId = config.templateIds.declined.en as string
    rows.set(liveId, { ...(rows.get(liveId) as WhatsAppTemplate), status: 'rejected' })
    rows.set('cand-x', buildWhatsAppTemplate({ id: 'cand-x', status: candidateStatus }))
    config = structuredClone(config)
    config.templateCandidates.declined.en = 'cand-x'
    deps.createTemplate.mockClear()
    deps.saveProvisioned.mockClear()
    return liveId
  }

  it.each(['rejected', 'draft'] as const)('a new live template clears the slot\'s %s candidate', async (status) => {
    const oldLive = await liveRejectedWithCandidate(status)
    await provision()
    expect(deps.createTemplate).toHaveBeenCalledTimes(1)
    expect(config.templateIds.declined.en).not.toBe(oldLive)
    expect(config.templateCandidates.declined.en).toBeUndefined()
    expect(deps.saveProvisioned.mock.calls[0][1]).toEqual([
      { kind: 'declined', language: 'en', id: config.templateIds.declined.en, staleCandidateId: 'cand-x' },
    ])
  })

  it('writes only the submitted slots, so a slot promoted meanwhile keeps its new id', async () => {
    await provision()
    const liveId = config.templateIds.declined.en as string
    rows.set(liveId, { ...(rows.get(liveId) as WhatsAppTemplate), status: 'rejected' })
    deps.saveProvisioned.mockImplementationOnce(async (_rid, slots) => {
      const promotedMeanwhile = structuredClone(config)
      promotedMeanwhile.templateIds.confirmed.en = 'promoted-by-sender'
      config = applyProvisionedTemplates(promotedMeanwhile, slots)
    })
    await provision()
    expect(config.templateIds.confirmed.en).toBe('promoted-by-sender')
    expect(config.templateIds.declined.en).not.toBe(liveId)
  })
})

describe('applyProvisionedTemplates', () => {
  it('clears a stale candidate only while it is still the stored one', () => {
    const base = structuredClone(DEFAULT_BOOKING_CONFIG)
    base.templateCandidates.declined.en = 'newer-edit'
    const next = applyProvisionedTemplates(base, [{ kind: 'declined', language: 'en', id: 'live-2', staleCandidateId: 'cand-x' }])
    expect(next.templateIds.declined.en).toBe('live-2')
    expect(next.templateCandidates.declined.en).toBe('newer-edit')
    expect(base.templateIds.declined.en).toBeNull()
  })
})

// BOOK-013 (spec AC-17, AC-18): `confirmed` carries the check-in QR as an IMAGE
// header; an existing tenant's live confirmed without one gets its QR version
// submitted as the slot's candidate while the old one keeps sending.
describe('provisionBookingTemplates and the check-in QR (BOOK-013)', () => {
  const QR_HEADER = { type: 'HEADER', format: 'IMAGE', example: { header_handle: [SAMPLE_QR] } }
  const confirmedCalls = () => deps.createTemplate.mock.calls.map((c) => c[0]).filter((c) => c.name.startsWith('booking_confirmed_'))

  function liveOldConfirmed(status: TemplateStatus = 'approved') {
    for (const [lang, id] of [['en', 'old-en'], ['zh_hk', 'old-zh']] as const) {
      rows.set(id, buildWhatsAppTemplate({ id, restaurantId: RID, status, components: [{ type: 'BODY', text: 'Old confirmed {{date}} {{time}}.' }] }))
      config = structuredClone(config)
      config.templateIds.confirmed[lang] = id
    }
  }

  it('a new confirmed is submitted with the QR header and {{code}} in the body; other kinds have no header', async () => {
    await provision()
    for (const call of confirmedCalls()) {
      expect(call.components[0]).toEqual(QR_HEADER)
      expect(call.components[1].text).toContain('{{code}}')
    }
    const others = deps.createTemplate.mock.calls.map((c) => c[0]).filter((c) => !c.name.startsWith('booking_confirmed_'))
    expect(others.every((c) => c.components.length === 1 && c.components[0].type === 'BODY')).toBe(true)
  })

  it('without the sample image no confirmed is submitted (next save retries); the other kinds still are', async () => {
    deps.qrExampleUrl!.mockResolvedValue(null)
    const statuses = await provision()
    expect(confirmedCalls()).toHaveLength(0)
    expect(deps.createTemplate).toHaveBeenCalledTimes(10)
    expect(statuses.confirmed).toEqual({ en: 'not_submitted', zh_hk: 'not_submitted' })
  })

  it.each(['approved', 'pending'] as const)('a live %s confirmed without the QR gets its QR version as the candidate; the old one stays live', async (status) => {
    liveOldConfirmed(status)
    await provision()
    const calls = confirmedCalls()
    expect(calls).toHaveLength(2)
    expect(calls.every((c) => c.components[0].type === 'HEADER')).toBe(true)
    expect(config.templateIds.confirmed).toEqual({ en: 'old-en', zh_hk: 'old-zh' })
    expect(config.templateCandidates.confirmed.en).toBeTruthy()
    expect(config.templateCandidates.confirmed.zh_hk).toBeTruthy()
    expect(config.templateBodies.confirmed.en).toBeUndefined()
  })

  it('a pending QR candidate is not submitted again', async () => {
    liveOldConfirmed()
    await provision()
    deps.createTemplate.mockClear()
    await provision()
    expect(confirmedCalls()).toHaveLength(0)
  })

  it('a QR candidate that never reached Meta is resubmitted in place on the next run, not created again', async () => {
    liveOldConfirmed()
    createdAs('draft')
    await provision()
    const candidates = { ...config.templateCandidates.confirmed }
    deps.createTemplate.mockClear()
    await provision()
    expect(confirmedCalls()).toHaveLength(0)
    const resubmitted = deps.resubmitTemplate.mock.calls.map((c) => c[0])
    for (const id of Object.values(candidates)) expect(resubmitted).toContain(id)
    expect(config.templateCandidates.confirmed).toEqual(candidates)
    expect(config.templateIds.confirmed).toEqual({ en: 'old-en', zh_hk: 'old-zh' })
  })

  it("the restaurant's own confirmed text keeps its words, with the code line added when it has none", async () => {
    liveOldConfirmed()
    config.templateBodies.confirmed.en = 'See you on {{date}} at {{time}}, {{name}}!'
    config.templateBodies.confirmed.zh_hk = '{{date}} {{time}} 見,入座編號 {{code}}。'
    await provision()
    const byLang = Object.fromEntries(confirmedCalls().map((c) => [c.language, c.components[1].text]))
    expect(byLang.en).toBe('See you on {{date}} at {{time}}, {{name}}! Check-in code: {{code}}.')
    expect(byLang.zh_HK).toBe('{{date}} {{time}} 見,入座編號 {{code}}。')
    expect(config.templateBodies.confirmed.en).toBe(byLang.en)
  })

  it('a live confirmed that already has the QR header is left alone', async () => {
    await provision()
    deps.createTemplate.mockClear()
    for (const id of Object.values(config.templateIds.confirmed) as string[]) rows.set(id, { ...(rows.get(id) as WhatsAppTemplate), status: 'approved' })
    await provision()
    expect(confirmedCalls()).toHaveLength(0)
  })
})
