// BOOK-002 B2-02 (AC-2, AC-4, AC-5, AC-6; R14, R22): an admin edits one
// booking message's text per language. A valid edit is stored and submitted
// as a new UTILITY template (the candidate) while the approved one keeps
// sending. The route and use case run for real; only storage, the template
// rows and the Meta submission are faked.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/infrastructure/supabase/guards/tenant-guard')
vi.mock('@/infrastructure/supabase/repositories/booking-config-repository', () => ({
  getBookingConfig: vi.fn(),
  saveBookingTemplateEdit: vi.fn(),
  saveBookingTemplateIds: vi.fn(),
}))
vi.mock('@/infrastructure/supabase/repositories/whatsapp-template-repository', () => ({
  findManyByIdsForRestaurant: vi.fn(),
}))
vi.mock('@/application/create-whatsapp-template', () => ({ createWhatsAppTemplate: vi.fn() }))
vi.mock('@/application/update-whatsapp-template', () => ({ updateWhatsAppTemplate: vi.fn() }))
vi.mock('@/application/ensure-waba-id', () => ({ ensureWabaId: vi.fn() }))

import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { getBookingConfig, saveBookingTemplateEdit } from '@/infrastructure/supabase/repositories/booking-config-repository'
import { findManyByIdsForRestaurant } from '@/infrastructure/supabase/repositories/whatsapp-template-repository'
import { createWhatsAppTemplate } from '@/application/create-whatsapp-template'
import { DEFAULT_BOOKING_CONFIG, type BookingConfig } from '@/domain/value-objects/booking-config'
import { applyBookingTemplateEdit } from '@/domain/services/booking-template-slot'
import { bookingTemplateBody } from '@/domain/services/booking-templates'
import type { WhatsAppTemplate } from '@/domain/entities/whatsapp-template'
import { buildWhatsAppTemplate } from '@/test-utils/builders'
import { PUT } from '../route'
import { GET } from '../../route'

const RID = 'rest-1'
const OLD_BODY = 'Hi {{name}}, your booking at {{restaurant}} for {{party_size}} on {{date}} at {{time}} is confirmed.'
const NEW_BODY = 'Your table at {{restaurant}} is confirmed for {{date}} at {{time}}. Reply here if your plans change at all.'
const DEFAULT_EN = bookingTemplateBody('confirmed', 'en')

let stored: BookingConfig
let rows: Map<string, WhatsAppTemplate>
let created = 0

const row = (id: string, status: WhatsAppTemplate['status'], text: string, extra: Partial<WhatsAppTemplate> = {}) => {
  const t = buildWhatsAppTemplate({ id, restaurantId: RID, status, category: 'UTILITY', components: [{ type: 'BODY', text }], ...extra })
  rows.set(id, t)
  return t
}

function as(role: string) {
  vi.mocked(getTenantContext).mockResolvedValue({ userId: 'u-1', restaurantId: RID, role, tenantStatus: 'active' })
}

const put = (body: unknown) =>
  PUT(new NextRequest('http://localhost/api/dashboard/settings/booking/templates', { method: 'PUT', body: JSON.stringify(body) }))
const edit = (body: string | null, kind = 'confirmed', language = 'en') => put({ kind, language, body })

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  as('admin')
  rows = new Map()
  created = 0
  row('tpl-old', 'approved', OLD_BODY)
  stored = structuredClone({
    ...DEFAULT_BOOKING_CONFIG,
    mode: 'simple',
    templateIds: { ...DEFAULT_BOOKING_CONFIG.templateIds, confirmed: { en: 'tpl-old', zh_hk: null } },
  }) as BookingConfig
  vi.mocked(getBookingConfig).mockImplementation(async () => structuredClone(stored))
  vi.mocked(saveBookingTemplateEdit).mockImplementation(async (_rid, e) => {
    stored = applyBookingTemplateEdit(stored, e)
  })
  vi.mocked(findManyByIdsForRestaurant).mockImplementation(async (ids) => ids.flatMap((id) => rows.get(id) ?? []))
  vi.mocked(createWhatsAppTemplate).mockImplementation(async (p) => ({
    template: row(`tpl-new-${++created}`, 'pending', p.components[0].text as string, { name: p.name, language: p.language }),
  }))
})

const nothingWritten = () => {
  expect(saveBookingTemplateEdit).not.toHaveBeenCalled()
  expect(createWhatsAppTemplate).not.toHaveBeenCalled()
}

describe('who and when (R14, R22)', () => {
  it('staff get 403 and nothing is stored or submitted', async () => {
    as('staff')
    expect((await edit(NEW_BODY)).status).toBe(403)
    nothingWritten()
  })

  it.each(['off', 'external'] as const)('mode %s → 409, nothing stored', async (mode) => {
    stored.mode = mode
    const res = await edit(NEW_BODY)
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'booking_mode_not_simple' })
    nothingWritten()
  })

  it.each([
    ['unknown kind', { kind: 'cancelled', language: 'en', body: NEW_BODY }],
    ['unknown language', { kind: 'confirmed', language: 'fr', body: NEW_BODY }],
    ['non-string body', { kind: 'confirmed', language: 'en', body: 42 }],
    ['missing body', { kind: 'confirmed', language: 'en' }],
    ['extra field', { kind: 'confirmed', language: 'en', body: NEW_BODY, templateIds: {} }],
  ])('a malformed request (%s) → 400', async (_, body) => {
    expect((await put(body)).status).toBe(400)
    nothingWritten()
  })
})

describe('validation errors → 400, nothing stored or submitted (AC-4)', () => {
  it.each([
    ['empty', '   '],
    ['too_long', `${'a'.repeat(1020)} ${NEW_BODY}`],
    ['link', `${NEW_BODY} See https://evil.example for more.`],
    ['unknown_placeholder', `Hi {{notes}}, ${NEW_BODY}`],
    ['missing_date', NEW_BODY.replace('{{date}}', 'Friday')],
    ['missing_time', NEW_BODY.replace('{{time}}', 'noon')],
    ['placeholder_at_edge', `{{name}} ${NEW_BODY}`],
    ['duplicate_placeholder', `${NEW_BODY} Again {{date}} it is.`],
  ])('%s', async (code, body) => {
    const res = await edit(body)
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.errors.map((e: { code: string }) => e.code)).toContain(code)
    nothingWritten()
  })
})

describe('a valid edit (AC-2)', () => {
  it('stores the trimmed body and submits it as a new UTILITY candidate; the approved one stays live', async () => {
    const res = await edit(`  ${NEW_BODY}\n`)
    expect(res.status).toBe(200)
    expect(createWhatsAppTemplate).toHaveBeenCalledTimes(1)
    const params = vi.mocked(createWhatsAppTemplate).mock.calls[0][0]
    expect(params).toMatchObject({ restaurantId: RID, language: 'en', category: 'UTILITY', components: [{ type: 'BODY', text: NEW_BODY }] })
    expect(params.name).toMatch(/^booking_confirmed_[0-9a-f]{6}$/)
    expect(stored.templateBodies.confirmed.en).toBe(NEW_BODY)
    expect(stored.templateCandidates.confirmed.en).toBe('tpl-new-1')
    expect(stored.templateIds.confirmed.en).toBe('tpl-old')
    const json = await res.json()
    expect(json.warnings).toEqual([])
    expect(json.templates.confirmed.en).toBe('approved')
    expect(json.slots.confirmed.en).toMatchObject({ status: 'approved', candidate: { status: 'pending', reason: null }, customBody: NEW_BODY })
  })

  it('a warning does not block the save (promotional term)', async () => {
    const res = await edit(`${NEW_BODY} A free drink awaits.`)
    expect(res.status).toBe(200)
    expect((await res.json()).warnings).toContainEqual({ code: 'promotional_term', detail: 'free' })
    expect(createWhatsAppTemplate).toHaveBeenCalledTimes(1)
  })

  it('an edit equal to the approved body submits nothing and clears an older candidate', async () => {
    await edit(NEW_BODY)
    expect(stored.templateCandidates.confirmed.en).toBe('tpl-new-1')
    const res = await edit(OLD_BODY)
    expect(res.status).toBe(200)
    expect(createWhatsAppTemplate).toHaveBeenCalledTimes(1)
    expect(stored.templateBodies.confirmed.en).toBe(OLD_BODY)
    expect(stored.templateCandidates.confirmed.en).toBeUndefined()
  })

  it('a repeated edit replaces the candidate', async () => {
    await edit(NEW_BODY)
    await edit(NEW_BODY.replace('at all', 'in any way'))
    expect(createWhatsAppTemplate).toHaveBeenCalledTimes(2)
    expect(stored.templateCandidates.confirmed.en).toBe('tpl-new-2')
    expect(stored.templateBodies.confirmed.en).toContain('in any way')
  })

  it('each language is its own slot', async () => {
    await edit('你的訂座已確認:{{restaurant}},日期{{date}},時間{{time}}。如有更改,請回覆此訊息通知我們。', 'confirmed', 'zh_hk')
    expect(vi.mocked(createWhatsAppTemplate).mock.calls[0][0].language).toBe('zh_HK')
    expect(stored.templateCandidates.confirmed.zh_hk).toBe('tpl-new-1')
    expect(stored.templateCandidates.confirmed.en).toBeUndefined()
  })

  it('an approved candidate is promoted before the edit is compared (lazy promotion)', async () => {
    row('tpl-cand', 'approved', NEW_BODY)
    stored.templateCandidates.confirmed.en = 'tpl-cand'
    stored.templateBodies.confirmed.en = NEW_BODY
    const res = await edit(NEW_BODY)
    expect(res.status).toBe(200)
    expect(createWhatsAppTemplate).not.toHaveBeenCalled()
    expect(stored.templateIds.confirmed.en).toBe('tpl-cand')
    expect(stored.templateCandidates.confirmed.en).toBeUndefined()
  })
})

describe('reset to default (AC-5)', () => {
  it('approved body already the default: the custom body is removed, the candidate cleared, nothing submitted', async () => {
    row('tpl-old', 'approved', DEFAULT_EN)
    await edit(NEW_BODY)
    const res = await edit(null)
    expect(res.status).toBe(200)
    expect(createWhatsAppTemplate).toHaveBeenCalledTimes(1)
    expect(stored.templateBodies.confirmed.en).toBeUndefined()
    expect(stored.templateCandidates.confirmed.en).toBeUndefined()
    expect((await res.json()).slots.confirmed.en).toMatchObject({ customBody: null, candidate: null, defaultBody: DEFAULT_EN })
  })

  it('approved body is not the default: the default is submitted as the candidate', async () => {
    stored.templateBodies.confirmed.en = OLD_BODY
    const res = await edit(null)
    expect(res.status).toBe(200)
    expect(vi.mocked(createWhatsAppTemplate).mock.calls[0][0].components).toEqual([{ type: 'BODY', text: DEFAULT_EN }])
    expect(stored.templateBodies.confirmed.en).toBeUndefined()
    expect(stored.templateCandidates.confirmed.en).toBe('tpl-new-1')
  })
})

describe('GET booking settings → templateEditor (AC-1, AC-3)', () => {
  const editor = async () => (await (await GET()).json()).templateEditor

  it('per kind × language: live status, candidate with Meta reason, custom body, default body, placeholders', async () => {
    row('tpl-cand', 'rejected', NEW_BODY, { rejectionReason: 'INVALID_FORMAT' })
    stored.templateCandidates.confirmed.en = 'tpl-cand'
    stored.templateBodies.confirmed.en = NEW_BODY
    const { canEdit, slots } = await editor()
    expect(canEdit).toBe(true)
    expect(slots.confirmed.en).toEqual({
      status: 'approved',
      candidate: { status: 'rejected', reason: 'INVALID_FORMAT' },
      customBody: NEW_BODY,
      defaultBody: DEFAULT_EN,
      placeholders: ['name', 'restaurant', 'date', 'time', 'party_size'],
    })
    expect(slots.declined.zh_hk).toMatchObject({ status: 'not_submitted', candidate: null, customBody: null })
    expect(slots.declined.zh_hk.placeholders).toContain('reason')
  })

  it('an approved candidate shows as the live template, with no candidate badge', async () => {
    row('tpl-old', 'rejected', OLD_BODY)
    row('tpl-cand', 'approved', NEW_BODY)
    stored.templateCandidates.confirmed.en = 'tpl-cand'
    const json = await (await GET()).json()
    expect(json.templates.confirmed.en).toBe('approved')
    expect(json.templateEditor.slots.confirmed.en).toMatchObject({ status: 'approved', candidate: null })
  })

  it('a candidate that never reached Meta reads failed', async () => {
    row('tpl-cand', 'draft', NEW_BODY)
    stored.templateCandidates.confirmed.en = 'tpl-cand'
    expect((await editor()).slots.confirmed.en.candidate).toEqual({ status: 'failed', reason: null })
  })

  it('staff may read but not edit', async () => {
    as('staff')
    expect((await editor()).canEdit).toBe(false)
  })
})
