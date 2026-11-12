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

const template = (status: WhatsAppTemplate['status']) =>
  ({ id: 'tpl-1', name: 'booking_confirmed', language: 'zh_HK', status, components: [] }) as unknown as WhatsAppTemplate

let deps: { [K in keyof BookingSenderDeps]: ReturnType<typeof vi.fn> }

beforeEach(() => {
  vi.restoreAllMocks()
  deps = {
    getConfig: vi.fn().mockResolvedValue({ ...DEFAULT_BOOKING_CONFIG, templateIds: { ...DEFAULT_BOOKING_CONFIG.templateIds, confirmed: 'tpl-1' } }),
    findTemplate: vi.fn().mockResolvedValue(template('approved')),
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
})
