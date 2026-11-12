// BOOK-001 W3-05 (AC-1 templates): turning on Simple booking submits the four
// booking UTILITY templates in zh_HK and en with per-attempt names, stores
// their ids, and is idempotent: re-saving submits nothing new, a rejected or
// failed one is resubmitted.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { provisionBookingTemplates, type ProvisionBookingTemplatesDeps } from '../booking/provision-booking-templates'
import { DEFAULT_BOOKING_CONFIG, type BookingConfig } from '@/domain/value-objects/booking-config'
import { buildWhatsAppTemplate } from '@/test-utils/builders'
import type { TemplateStatus, WhatsAppTemplate } from '@/domain/entities/whatsapp-template'

const RID = 'rest-a'

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
    saveTemplateIds: vi.fn(async (_rid, ids) => { config = { ...config, templateIds: ids } }),
    suffix: vi.fn(() => `s${++suffix}`),
  }
  createdAs('pending')
})

const provision = () => provisionBookingTemplates(RID, deps as unknown as ProvisionBookingTemplatesDeps)

describe('provisionBookingTemplates', () => {
  it('submits 4 kinds × 2 languages as UTILITY with minted unique names and stores their ids', async () => {
    const statuses = await provision()
    expect(deps.createTemplate).toHaveBeenCalledTimes(8)
    const calls = deps.createTemplate.mock.calls.map((c) => c[0])
    expect(new Set(calls.map((c) => c.category))).toEqual(new Set(['UTILITY']))
    expect(new Set(calls.map((c) => c.restaurantId))).toEqual(new Set([RID]))
    expect(new Set(calls.map((c) => `${c.name}/${c.language}`)).size).toBe(8)
    expect(new Set(calls.map((c) => c.language))).toEqual(new Set(['en', 'zh_HK']))
    for (const kind of ['received', 'confirmed', 'declined', 'reminder']) {
      expect(calls.filter((c) => c.name.startsWith(`booking_${kind}_`))).toHaveLength(2)
    }
    expect(deps.saveTemplateIds).toHaveBeenCalledTimes(1)
    const ids = deps.saveTemplateIds.mock.calls[0][1]
    expect(Object.values(ids).flatMap((byLang) => Object.values(byLang as object)).every((id) => typeof id === 'string')).toBe(true)
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
    expect(deps.resubmitTemplate).toHaveBeenCalledTimes(8)
  })

  // F12 (review S-5): with the provider down, each Simple save used to leave
  // 8 more draft rows in the restaurant's template list.
  it('three saves with the provider failing leave 8 rows, not 24: a failed draft is resubmitted in place', async () => {
    deps.createTemplate.mockImplementation(async (p) => {
      const t = buildWhatsAppTemplate({ id: `t${++seq}`, restaurantId: RID, name: p.name, language: p.language, status: 'draft' })
      rows.set(t.id, t)
      return { template: t, error: 'Failed to submit template to Meta', errorCode: 'provider_error' }
    })
    await provision()
    await provision()
    const statuses = await provision()
    expect(rows.size).toBe(8)
    expect(deps.createTemplate).toHaveBeenCalledTimes(8)
    expect(deps.resubmitTemplate).toHaveBeenCalledTimes(16)
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
    expect(rows.size).toBe(8)
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
    expect(deps.saveTemplateIds).toHaveBeenCalledTimes(1)
  })

  it('looks templates up scoped to the restaurant', async () => {
    await provision()
    await provision()
    expect(deps.findTemplates.mock.calls.every((c) => c[1] === RID)).toBe(true)
  })
})
