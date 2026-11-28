// BOOK-002 B2-03 (AC-3, AC-7): the sender uses an edited template once Meta
// approves it and promotes it to the live slot exactly once; until then the
// old approved template keeps sending. The text fallback uses the custom body.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createBookingMessageSender, type BookingSenderDeps } from '../booking/send-booking-message'
import { DEFAULT_BOOKING_CONFIG, type BookingConfig } from '@/domain/value-objects/booking-config'
import { buildWhatsAppTemplate } from '@/test-utils/builders'
import type { WhatsAppTemplate } from '@/domain/entities/whatsapp-template'

const RID = 'rest-a'
const PHONE = '+85291234567'
const INPUT = {
  restaurantId: RID,
  phone: PHONE,
  memberId: null,
  kind: 'confirmed' as const,
  details: { restaurantName: 'Kushiro', name: 'Chan\nTai Man', date: '2026-11-13', time: '19:30', partySize: 4 },
}
const OLD_BODY = 'Hi {{name}}, your booking at {{restaurant}} for {{party_size}} on {{date}} at {{time}} is confirmed.'
const NEW_BODY = 'Your table at {{restaurant}} is confirmed for {{date}} at {{time}}. Reply here if plans change.'

let config: BookingConfig
let rows: Map<string, WhatsAppTemplate>
let promotions: number
let deps: BookingSenderDeps

const row = (id: string, status: WhatsAppTemplate['status'], text: string) =>
  rows.set(id, buildWhatsAppTemplate({ id, restaurantId: RID, status, components: [{ type: 'BODY', text }] }))

// A store whose promotion is a compare-and-swap on the candidate id, the
// contract the repository implements with a conditional update.
async function promoteCandidate(_rid: string, kind: 'confirmed', language: 'en' | 'zh_hk', candidateId: string) {
  await Promise.resolve()
  if (config.templateCandidates[kind][language] !== candidateId) return false
  config = structuredClone(config)
  config.templateIds[kind][language] = candidateId
  delete config.templateCandidates[kind][language]
  promotions++
  return true
}

beforeEach(() => {
  vi.restoreAllMocks()
  rows = new Map()
  promotions = 0
  row('tpl-old', 'approved', OLD_BODY)
  config = structuredClone({
    ...DEFAULT_BOOKING_CONFIG,
    mode: 'simple',
    templateIds: { ...DEFAULT_BOOKING_CONFIG.templateIds, confirmed: { en: 'tpl-old', zh_hk: null } },
  }) as BookingConfig
  config.templateCandidates.confirmed.en = 'tpl-new'
  deps = {
    getConfig: vi.fn(async () => structuredClone(config)),
    findTemplates: vi.fn(async (ids: string[]) => ids.flatMap((id) => rows.get(id) ?? [])),
    promoteCandidate: vi.fn(promoteCandidate),
    getPhoneNumberId: vi.fn().mockResolvedValue('pn-1'),
    isWindowOpen: vi.fn().mockResolvedValue(true),
    getLanguage: vi.fn().mockResolvedValue('en'),
    sendTemplate: vi.fn().mockResolvedValue({ ok: true, kapsoMessageId: 'w1', raw: null }),
    sendText: vi.fn().mockResolvedValue({ ok: true, kapsoMessageId: 'w2', raw: null }),
  } as unknown as BookingSenderDeps
})

const send = (input = INPUT) => createBookingMessageSender(deps).send(input)
const sentTemplates = () => vi.mocked(deps.sendTemplate).mock.calls.map(([a]) => a.template.id)

describe('an approved candidate', () => {
  it('is sent with its own body params and promoted to the live slot', async () => {
    row('tpl-new', 'approved', NEW_BODY)
    expect(await send()).toEqual({ delivered: true, via: 'template' })
    expect(sentTemplates()).toEqual(['tpl-new'])
    expect(vi.mocked(deps.sendTemplate).mock.calls[0][0].paramValues).toEqual({
      restaurant: 'Kushiro', date: '2026-11-13', time: '19:30',
    })
    expect(deps.promoteCandidate).toHaveBeenCalledWith(RID, 'confirmed', 'en', 'tpl-new')
    expect(config.templateIds.confirmed.en).toBe('tpl-new')
    expect(config.templateCandidates.confirmed.en).toBeUndefined()
  })

  it('concurrent sends both use it and it is promoted once', async () => {
    row('tpl-new', 'approved', NEW_BODY)
    const results = await Promise.all([send(), send(), send()])
    expect(results.every((r) => r.delivered)).toBe(true)
    expect(sentTemplates()).toEqual(['tpl-new', 'tpl-new', 'tpl-new'])
    expect(promotions).toBe(1)
  })

  it('after promotion the next send uses it as the live template without promoting again', async () => {
    row('tpl-new', 'approved', NEW_BODY)
    await send()
    await send()
    expect(sentTemplates()).toEqual(['tpl-new', 'tpl-new'])
    expect(deps.promoteCandidate).toHaveBeenCalledTimes(1)
  })

  it('a failed promotion write still delivers the approved candidate', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    row('tpl-new', 'approved', NEW_BODY)
    vi.mocked(deps.promoteCandidate).mockRejectedValue(new Error('db down'))
    expect(await send()).toEqual({ delivered: true, via: 'template' })
    expect(sentTemplates()).toEqual(['tpl-new'])
  })

  it('is used even when the old slot has no approved template', async () => {
    row('tpl-old', 'rejected', OLD_BODY)
    row('tpl-new', 'approved', NEW_BODY)
    await send()
    expect(sentTemplates()).toEqual(['tpl-new'])
  })
})

describe('a candidate Meta has not approved', () => {
  it.each(['pending', 'rejected', 'draft'] as const)('%s → the old approved template is sent with its own params, no promotion', async (status) => {
    row('tpl-new', status, NEW_BODY)
    expect(await send()).toEqual({ delivered: true, via: 'template' })
    expect(sentTemplates()).toEqual(['tpl-old'])
    expect(Object.keys(vi.mocked(deps.sendTemplate).mock.calls[0][0].paramValues).sort()).toEqual(
      ['date', 'name', 'party_size', 'restaurant', 'time']
    )
    expect(deps.promoteCandidate).not.toHaveBeenCalled()
  })

  it('a missing candidate row is ignored', async () => {
    await send()
    expect(sentTemplates()).toEqual(['tpl-old'])
  })
})

describe('text fallback parity (AC-7)', () => {
  beforeEach(() => {
    row('tpl-old', 'pending', OLD_BODY)
  })

  it('renders the custom body with the same sanitised params', async () => {
    config.templateBodies.confirmed.en = 'Hi {{name}}, {{restaurant}} has your table on {{date}} at {{time}} for {{party_size}}.'
    expect(await send()).toEqual({ delivered: true, via: 'text' })
    expect(vi.mocked(deps.sendText).mock.calls[0][2]).toBe('Hi Chan Tai Man, Kushiro has your table on 2026-11-13 at 19:30 for 4.')
  })

  it('uses the custom body of the diner language', async () => {
    vi.mocked(deps.getLanguage).mockResolvedValue('zh_hk')
    config.templateBodies.confirmed.zh_hk = '親愛的{{name}}你好,{{restaurant}}已確認:{{date}} {{time}}。'
    config.templateBodies.confirmed.en = 'Not this one {{date}} {{time}} ok.'
    await send()
    expect(vi.mocked(deps.sendText).mock.calls[0][2]).toBe('親愛的Chan Tai Man你好,Kushiro已確認:2026-11-13 19:30。')
  })

  it('without a custom body it keeps the default copy', async () => {
    await send()
    expect(vi.mocked(deps.sendText).mock.calls[0][2]).toContain('Your table booking is confirmed.')
  })
})

// BOOK-002 F1 C8: one template lookup per send, and promotion never delays it.
describe('lookups and promotion order (C8)', () => {
  it('reads the candidate and live rows of both languages in one call', async () => {
    config.templateIds.confirmed.zh_hk = 'tpl-zh'
    row('tpl-new', 'approved', NEW_BODY)
    await send()
    expect(deps.findTemplates).toHaveBeenCalledTimes(1)
    expect(vi.mocked(deps.findTemplates).mock.calls[0][0].sort()).toEqual(['tpl-new', 'tpl-old', 'tpl-zh'])
    expect(vi.mocked(deps.findTemplates).mock.calls[0][1]).toBe(RID)
  })

  it('sends first, then promotes', async () => {
    row('tpl-new', 'approved', NEW_BODY)
    await send()
    expect(vi.mocked(deps.sendTemplate).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(deps.promoteCandidate).mock.invocationCallOrder[0]
    )
  })

  it('a failed send still promotes the approved candidate, and the result is the send\'s', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    row('tpl-new', 'approved', NEW_BODY)
    vi.mocked(deps.sendTemplate).mockResolvedValue({ ok: false, kapsoMessageId: null, raw: null, error: { title: 'meta_error' } } as never)
    expect(await send()).toEqual({ delivered: false, reason: 'send_failed' })
    expect(promotions).toBe(1)
  })

  it('a promotion that throws synchronously never fails the send', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    row('tpl-new', 'approved', NEW_BODY)
    vi.mocked(deps.promoteCandidate).mockImplementation(() => { throw new Error('boom') })
    expect(await send()).toEqual({ delivered: true, via: 'template' })
  })
})
