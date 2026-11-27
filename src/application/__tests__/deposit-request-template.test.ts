// BOOK-014 W4 (spec AC-11, owner R21 exception 2026-11-27): the UTILITY
// template `booking_deposit_request` in zh_HK and en with ONE URL button
// `<app>/p/{{1}}`, provisioned with the other booking templates, sent with the
// /p token as the button variable; and the decline line of AC-12 in a template.
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/infrastructure/whatsapp/templates', () => ({ sendTemplateMessage: vi.fn(async () => ({ ok: true, kapsoMessageId: 'w1', raw: null })) }))

import { sendTemplateMessage } from '@/infrastructure/whatsapp/templates'
import { sendWhatsAppTemplateMessage } from '../send-template-message'
import { provisionBookingTemplates, type ProvisionBookingTemplatesDeps } from '../booking/provision-booking-templates'
import { createBookingMessageSender, type BookingSenderDeps } from '../booking/send-booking-message'
import { depositRequestComponents, bookingTemplateBody } from '@/domain/services/booking-templates'
import { validateBookingTemplateBody } from '@/domain/services/booking-template-body'
import { prepareTemplateComponents } from '@/domain/services/prepare-template-components'
import { DEFAULT_BOOKING_CONFIG, EDITABLE_TEMPLATE_KINDS, TEMPLATE_KINDS, type BookingConfig } from '@/domain/value-objects/booking-config'
import { applyProvisionedTemplates } from '@/domain/services/booking-template-slot'
import { buildWhatsAppTemplate } from '@/test-utils/builders'
import type { TemplateComponent, WhatsAppTemplate } from '@/domain/entities/whatsapp-template'

const APP = 'https://app.ohmyclient.test'
const TOKEN = 'Abc_DEF-0123456789abcdefghijklmnopqrstuvwxy'

describe('the deposit request template (R21 exception)', () => {
  it('BODY + exactly one URL button on our own domain, `<app>/p/{{1}}`, per language', () => {
    for (const lang of ['zh_hk', 'en'] as const) {
      const c = depositRequestComponents(bookingTemplateBody('deposit_request', lang), lang, `${APP}/`)
      expect(c.map((x) => x.type)).toEqual(['BODY', 'BUTTONS'])
      expect(c[1].buttons).toHaveLength(1)
      expect(c[1].buttons![0]).toMatchObject({ type: 'URL', url: `${APP}/p/{{1}}`, example: `${APP}/p/sample-payment-link` })
    }
  })

  it('the default copy names restaurant, date, time, party, amount and hold end, and passes the body rules', () => {
    for (const lang of ['zh_hk', 'en'] as const) {
      const body = bookingTemplateBody('deposit_request', lang)
      for (const p of ['restaurant', 'date', 'time', 'party_size', 'amount', 'hold_until']) expect(body).toContain(`{{${p}}}`)
      expect(validateBookingTemplateBody('deposit_request', lang, body).errors).toEqual([])
    }
  })

  it('it is a template kind, but not an editable one (its button would be lost)', () => {
    expect(TEMPLATE_KINDS).toContain('deposit_request')
    expect(EDITABLE_TEMPLATE_KINDS).not.toContain('deposit_request')
  })

  it('every named param has a Meta example (hold end and amount included)', () => {
    const [body] = prepareTemplateComponents(depositRequestComponents(bookingTemplateBody('deposit_request', 'en'), 'en', APP))
    expect(JSON.stringify(body)).not.toContain('"example":"example"')
  })
})

describe('provisioning (the existing booking-template path)', () => {
  let rows: Map<string, WhatsAppTemplate>
  let config: BookingConfig
  let seq = 0
  const deps = (appBaseUrl?: string) => ({
    getConfig: vi.fn(async () => config),
    findTemplates: vi.fn(async (ids: string[]) => ids.flatMap((id) => rows.get(id) ?? [])),
    createTemplate: vi.fn(async (p: { name: string; language: string; category: 'UTILITY'; components: TemplateComponent[] }) => {
      const t = buildWhatsAppTemplate({ id: `t${++seq}`, restaurantId: 'r', name: p.name, language: p.language, category: p.category, status: 'pending', components: p.components })
      rows.set(t.id, t)
      return { template: t }
    }),
    resubmitTemplate: vi.fn(),
    saveProvisioned: vi.fn(async (_r: string, slots: Parameters<typeof applyProvisionedTemplates>[1]) => void (config = applyProvisionedTemplates(config, slots))),
    ensureWabaId: vi.fn(async () => 'waba'),
    suffix: () => `s${seq}`,
    ...(appBaseUrl ? { appBaseUrl } : {}),
  })

  beforeEach(() => {
    rows = new Map()
    config = { ...structuredClone(DEFAULT_BOOKING_CONFIG), mode: 'simple' }
  })

  it('submits booking_deposit_request_* as UTILITY in zh_HK and en with the one /p button, and stores both ids', async () => {
    const d = deps(APP)
    const statuses = await provisionBookingTemplates('r', d as unknown as ProvisionBookingTemplatesDeps)
    const calls = d.createTemplate.mock.calls.map((c) => c[0]).filter((c) => c.name.startsWith('booking_deposit_request_'))
    expect(calls.map((c) => c.language).sort()).toEqual(['en', 'zh_HK'])
    for (const c of calls) {
      expect(c.category).toBe('UTILITY')
      const buttons = c.components.find((x) => x.type === 'BUTTONS')?.buttons ?? []
      expect(buttons).toEqual([expect.objectContaining({ type: 'URL', url: `${APP}/p/{{1}}` })])
    }
    // R21: no other booking template carries a button.
    const others = d.createTemplate.mock.calls.map((c) => c[0]).filter((c) => !c.name.startsWith('booking_deposit_request_'))
    expect(others.every((c) => c.components.every((x) => x.type === 'BODY'))).toBe(true)
    expect(statuses.deposit_request).toEqual({ en: 'pending', zh_hk: 'pending' })
    expect(config.templateIds.deposit_request.en).toBeTruthy()
  })

  it('without a public app URL the deposit request is not submitted (it reads not_submitted)', async () => {
    const d = deps()
    const statuses = await provisionBookingTemplates('r', d as unknown as ProvisionBookingTemplatesDeps)
    expect(d.createTemplate.mock.calls.some((c) => c[0].name.startsWith('booking_deposit_request_'))).toBe(false)
    expect(statuses.deposit_request).toEqual({ en: 'not_submitted', zh_hk: 'not_submitted' })
  })
})

describe('sending it', () => {
  const depositTemplate = {
    id: 'dep-en', name: 'booking_deposit_request_s1', language: 'en', status: 'approved', category: 'UTILITY',
    components: depositRequestComponents(bookingTemplateBody('deposit_request', 'en'), 'en', APP),
  } as unknown as WhatsAppTemplate
  const input = {
    restaurantId: 'r', phone: '+85291234567', memberId: null, kind: 'deposit_request' as const,
    details: {
      restaurantName: 'Kushiro', name: 'Chan', date: '2026-11-28', time: '19:00', partySize: 4,
      depositRequest: { amount: { amountMinor: 40000, currency: 'HKD' }, holdUntil: '2026-11-27 10:58', linkUrl: `${APP}/p/${TOKEN}`, linkToken: TOKEN },
    },
  }
  let deps: { [K in keyof BookingSenderDeps]: ReturnType<typeof vi.fn> }

  beforeEach(() => {
    vi.mocked(sendTemplateMessage).mockClear()
    deps = {
      getConfig: vi.fn(async () => ({ ...DEFAULT_BOOKING_CONFIG, templateIds: { ...DEFAULT_BOOKING_CONFIG.templateIds, deposit_request: { en: 'dep-en', zh_hk: null } } })),
      findTemplates: vi.fn(async () => [depositTemplate]),
      promoteCandidate: vi.fn(),
      getPhoneNumberId: vi.fn(async () => 'pn'),
      isWindowOpen: vi.fn(async () => false),
      getLanguage: vi.fn(async () => 'en'),
      sendTemplate: vi.fn(async () => ({ ok: true, kapsoMessageId: 'w', raw: null })),
      sendText: vi.fn(),
    }
  })

  it('the approved template goes out with amount + hold end in the body and the /p token for the button', async () => {
    expect(await createBookingMessageSender(deps as unknown as BookingSenderDeps).send(input)).toEqual({ delivered: true, via: 'template' })
    const args = deps.sendTemplate.mock.calls[0][0]
    expect(args.linkToken).toBe(TOKEN)
    expect(args.paramValues).toMatchObject({ amount: 'HK$400', hold_until: '2026-11-27 10:58', restaurant: 'Kushiro', party_size: '4' })
  })

  it('no approved template and the window closed: not delivered (the staff toast offers Copy link)', async () => {
    deps.findTemplates.mockResolvedValue([])
    expect(await createBookingMessageSender(deps as unknown as BookingSenderDeps).send(input)).toEqual({ delivered: false, reason: 'outside_window' })
  })

  it('in an open window without a template, the free text carries the link', async () => {
    deps.findTemplates.mockResolvedValue([])
    deps.isWindowOpen.mockResolvedValue(true)
    deps.sendText.mockResolvedValue({ ok: true, kapsoMessageId: 'w', raw: null })
    await createBookingMessageSender(deps as unknown as BookingSenderDeps).send(input)
    expect(deps.sendText.mock.calls[0][2]).toContain(`${APP}/p/${TOKEN}`)
    expect(deps.sendText.mock.calls[0][2]).toContain('HK$400')
  })

  it('the wire payload: one URL button parameter (index 0) whose text is the /p token', async () => {
    await sendWhatsAppTemplateMessage({ phoneNumberId: 'pn', to: '+85291234567', template: depositTemplate, paramValues: {}, couponCode: TOKEN })
    const params = vi.mocked(sendTemplateMessage).mock.calls[0][2]
    expect(params.buttons).toEqual([{ type: 'button', subType: 'url', index: 0, parameters: [{ type: 'text', text: TOKEN }] }])
  })

  it('AC-12 in a template: an approved declined template carries the refund line in {{reason}}, in the template\'s language', async () => {
    const declined = { id: 'dec-zh', name: 'booking_declined_s1', language: 'zh_HK', status: 'approved', components: [{ type: 'BODY', text: bookingTemplateBody('declined', 'zh_hk') }] } as unknown as WhatsAppTemplate
    deps.getConfig.mockResolvedValue({ ...DEFAULT_BOOKING_CONFIG, templateIds: { ...DEFAULT_BOOKING_CONFIG.templateIds, declined: { en: null, zh_hk: 'dec-zh' } } })
    deps.findTemplates.mockResolvedValue([declined])
    await createBookingMessageSender(deps as unknown as BookingSenderDeps).send({
      restaurantId: 'r', phone: '+85291234567', memberId: null, kind: 'declined',
      details: { restaurantName: 'K', name: 'C', date: '2026-11-28', time: '19:00', partySize: 2, declineReason: '客滿', depositRefund: { amountMinor: 40000, currency: 'HKD' } },
    })
    expect(deps.sendTemplate.mock.calls[0][0].paramValues.reason).toBe('客滿 · 你的訂金 HK$400 將會退回。')
    expect(deps.sendTemplate.mock.calls[0][0].linkToken).toBeUndefined()
  })
})
