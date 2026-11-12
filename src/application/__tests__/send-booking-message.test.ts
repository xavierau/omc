import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createBookingMessageSender, type BookingSenderDeps } from '../booking/send-booking-message'
import { DEFAULT_BOOKING_CONFIG } from '@/domain/value-objects/booking-config'
import type { WhatsAppTemplate } from '@/domain/entities/whatsapp-template'

const PHONE = '+85291234567'
const INPUT = {
  restaurantId: 'rest-a',
  phone: PHONE,
  memberId: null,
  kind: 'confirmed' as const,
  details: { restaurantName: 'Kushiro', name: 'Chan\nTai Man', date: '2026-11-13', time: '19:30', partySize: 4 },
}

// The confirmed body stored before F3 (still the shape of rows Meta approved).
const OLD_CONFIRMED_EN = 'Hi {{name}}, your booking at {{restaurant}} for {{party_size}} on {{date}} at {{time}} is confirmed.'

const template = (status: WhatsAppTemplate['status'], body = OLD_CONFIRMED_EN) =>
  ({ id: 'tpl-1', name: 'booking_confirmed', language: 'en', status, components: [{ type: 'BODY', text: body }] }) as unknown as WhatsAppTemplate

let deps: { [K in keyof BookingSenderDeps]: ReturnType<typeof vi.fn> }

beforeEach(() => {
  vi.restoreAllMocks()
  deps = {
    getConfig: vi.fn().mockResolvedValue({ ...DEFAULT_BOOKING_CONFIG, templateIds: { ...DEFAULT_BOOKING_CONFIG.templateIds, confirmed: { en: 'tpl-1', zh_hk: null } } }),
    findTemplate: vi.fn().mockResolvedValue(template('approved')),
    promoteCandidate: vi.fn().mockResolvedValue(true),
    getPhoneNumberId: vi.fn().mockResolvedValue('pn-1'),
    isWindowOpen: vi.fn().mockResolvedValue(true),
    getLanguage: vi.fn().mockResolvedValue('en'),
    sendTemplate: vi.fn().mockResolvedValue({ ok: true, kapsoMessageId: 'w1', raw: null }),
    sendText: vi.fn().mockResolvedValue({ ok: true, kapsoMessageId: 'w2', raw: null }),
  }
})

const send = () => createBookingMessageSender(deps as unknown as BookingSenderDeps).send(INPUT)

describe('booking message sender ladder', () => {
  it('sends the approved template with sanitised named params, scoped to the restaurant', async () => {
    expect(await send()).toEqual({ delivered: true, via: 'template' })
    expect(deps.findTemplate).toHaveBeenCalledWith('tpl-1', 'rest-a')
    const args = deps.sendTemplate.mock.calls[0][0]
    expect(args.paramValues.name).toBe('Chan Tai Man')
    expect(deps.sendText).not.toHaveBeenCalled()
  })

  it.each(['pending', 'rejected', 'paused'] as const)('skips a %s template and sends free text in an open window', async (status) => {
    deps.findTemplate.mockResolvedValue(template(status))
    expect(await send()).toEqual({ delivered: true, via: 'text' })
    expect(deps.sendText.mock.calls[0][2]).toContain('confirmed')
  })

  it('returns outside_window when there is no approved template and the window is closed', async () => {
    deps.getConfig.mockResolvedValue(DEFAULT_BOOKING_CONFIG)
    deps.isWindowOpen.mockResolvedValue(false)
    expect(await send()).toEqual({ delivered: false, reason: 'outside_window' })
    expect(deps.sendText).not.toHaveBeenCalled()
  })

  it('never throws: an exception becomes delivered:false and logs no phone', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    deps.getConfig.mockRejectedValue(new Error(`db down for ${PHONE}`))
    expect(await send()).toEqual({ delivered: false, reason: 'error' })
    expect(JSON.stringify(warn.mock.calls)).not.toContain(PHONE)
  })

  it('reports a failed send without logging the phone or the name', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    deps.sendTemplate.mockResolvedValue({ ok: false, kapsoMessageId: null, raw: null, error: { title: 'meta_error' } })
    expect(await send()).toEqual({ delivered: false, reason: 'send_failed' })
    const logged = JSON.stringify(warn.mock.calls)
    expect(logged).toContain('***4567')
    expect(logged).not.toContain(PHONE)
    expect(logged).not.toContain('Chan')
  })

  it('reports no_sender when the restaurant has no WhatsApp number id', async () => {
    deps.getPhoneNumberId.mockResolvedValue('')
    expect(await send()).toEqual({ delivered: false, reason: 'no_sender' })
  })

  it('W3: uses the diner language template first, else the other language', async () => {
    deps.getConfig.mockResolvedValue({
      ...DEFAULT_BOOKING_CONFIG,
      templateIds: { ...DEFAULT_BOOKING_CONFIG.templateIds, confirmed: { en: 'tpl-en', zh_hk: 'tpl-zh' } },
    })
    deps.getLanguage.mockResolvedValue('zh_hk')
    await send()
    expect(deps.findTemplate).toHaveBeenNthCalledWith(1, 'tpl-zh', 'rest-a')

    deps.findTemplate.mockReset()
    deps.findTemplate.mockResolvedValueOnce(template('pending')).mockResolvedValueOnce(template('approved'))
    expect(await send()).toEqual({ delivered: true, via: 'template' })
    expect(deps.findTemplate.mock.calls.map((c) => c[0])).toEqual(['tpl-zh', 'tpl-en'])
  })
})

// BOOK-001 F3: rows already at Meta keep their old bodies while resubmitted
// kinds get new ones, so the params come from THAT row's BODY, never a fixed
// set per kind. An extra or missing named param makes Meta refuse the send.
describe('booking template params follow the stored body (F3)', () => {
  const NEW_CONFIRMED_EN =
    'Your table booking is confirmed. Restaurant: {{restaurant}}. Date: {{date}}. Time: {{time}}. Party size: {{party_size}}. If your plans change, please reply to this message to let the restaurant know.'
  const OLD_REMINDER_ZH = '提提你:你在{{restaurant}}有{{party_size}}位的訂座:{{date}} {{time}}。'
  const NEW_REMINDER_EN =
    'This is a reminder of your upcoming table booking at {{restaurant}} on {{date}} at {{time}}. If you can no longer make it, please reply to this message to let the restaurant know.'

  const sentParams = async (body: string, kind: 'confirmed' | 'reminder' = 'confirmed') => {
    deps.getConfig.mockResolvedValue({
      ...DEFAULT_BOOKING_CONFIG,
      templateIds: { ...DEFAULT_BOOKING_CONFIG.templateIds, [kind]: { en: 'tpl-1', zh_hk: null } },
    })
    deps.findTemplate.mockResolvedValue(template('approved', body))
    const result = await createBookingMessageSender(deps as unknown as BookingSenderDeps).send({ ...INPUT, kind })
    return { result, params: deps.sendTemplate.mock.calls[0]?.[0].paramValues }
  }

  it('an old-body row gets its old param set, name included', async () => {
    const { params } = await sentParams(OLD_CONFIRMED_EN)
    expect(params).toEqual({ name: 'Chan Tai Man', restaurant: 'Kushiro', party_size: '4', date: '2026-11-13', time: '19:30' })
  })

  it('a new-body row of the same kind gets only its own params (no name)', async () => {
    const { params } = await sentParams(NEW_CONFIRMED_EN)
    expect(params).toEqual({ restaurant: 'Kushiro', date: '2026-11-13', time: '19:30', party_size: '4' })
  })

  it('the new en reminder carries no party_size; the approved zh_HK reminder still does', async () => {
    expect((await sentParams(NEW_REMINDER_EN, 'reminder')).params).toEqual({ restaurant: 'Kushiro', date: '2026-11-13', time: '19:30' })
    deps.sendTemplate.mockClear()
    expect((await sentParams(OLD_REMINDER_ZH, 'reminder')).params).toEqual({
      restaurant: 'Kushiro', party_size: '4', date: '2026-11-13', time: '19:30',
    })
  })

  it('refuses a stored body naming a param the sender cannot fill, before the network', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { result } = await sentParams('Your booking {{booking_ref}} is confirmed.')
    expect(result).toEqual({ delivered: false, reason: 'send_failed' })
    expect(deps.sendTemplate).not.toHaveBeenCalled()
  })
})
