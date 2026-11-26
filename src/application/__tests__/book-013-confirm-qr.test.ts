// BOOK-013 (spec S6, AC-17; threat R8, R10): every move to confirmed mints the
// check-in code in the same write, and the confirmation carries the code and
// the QR link: as the IMAGE header of a QR template, or as an image with the
// text as caption inside the 24-hour window. A QR template never goes out
// with its sample image (no link → not delivered). Old approved templates
// without the QR keep sending (AC-18).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { decideBookingRequest, type DecideBookingDeps } from '../booking/decide-booking-request'
import { createBookingMessageSender, type BookingSenderDeps } from '../booking/send-booking-message'
import { FakeBookingRequests, FakeBookingSender, FakeBookingSettings } from '@/test-utils/fake-booking'
import { FakeCheckinQr } from '@/test-utils/fake-staff-booking'
import { DEFAULT_BOOKING_CONFIG } from '@/domain/value-objects/booking-config'
import { bookingKindComponents, bookingTemplateBody } from '@/domain/services/booking-templates'
import type { WhatsAppTemplate } from '@/domain/entities/whatsapp-template'

const A = 'rest-a'
const NOW = new Date('2026-11-26T03:00:00.000Z')

describe('decide → confirmed mints the code and sends it with the QR (R8, AC-17)', () => {
  let requests: FakeBookingRequests
  let sender: FakeBookingSender
  let qr: FakeCheckinQr
  let deps: DecideBookingDeps

  beforeEach(() => {
    requests = new FakeBookingRequests()
    sender = new FakeBookingSender()
    qr = new FakeCheckinQr()
    const settings = new FakeBookingSettings()
    settings.restaurants.set(A, { name: 'Kushiro', logoUrl: null, whatsappNumber: null })
    deps = { requests, settings, sender, now: () => NOW, newCodes: () => ['K7Q2MX', 'H4PN8R'], qr }
  })

  const seed = async (extra: Record<string, unknown> = {}) =>
    (await requests.insert({ restaurantId: A, memberId: null, phone: '+85291234567', name: 'Chan', partySize: 2, bookingDate: '2026-11-28',
      bookingTime: '19:30', notes: 'allergy', source: 'chat', campaignId: null, token: null, ...extra })).id

  it('a plain confirm writes the code and the message carries the code and the QR link', async () => {
    const id = await seed()
    const decideSpy = vi.spyOn(requests, 'decide')
    expect((await decideBookingRequest(deps, { restaurantId: A, userId: 'u', bookingId: id, decision: 'confirmed' })).ok).toBe(true)
    expect(decideSpy.mock.calls[0][0].checkinCodes).toEqual(['K7Q2MX', 'H4PN8R'])
    expect(requests.rows[0]).toMatchObject({ status: 'confirmed', checkinCode: 'K7Q2MX' })
    expect(sender.sent[0]).toMatchObject({ kind: 'confirmed', details: { checkinCode: 'K7Q2MX' }, image: qr.url })
    expect(qr.ensured).toEqual([`${id}:K7Q2MX`])
  })

  it('a change confirm mints the code in the same RPC call', async () => {
    const original = await seed({ token: 't1' })
    requests.rows[0].status = 'confirmed'
    const change = await seed({ token: 't2', replacesBookingId: original })
    const spy = vi.spyOn(requests, 'confirmChange')
    await decideBookingRequest(deps, { restaurantId: A, userId: 'u', bookingId: change, decision: 'confirmed' })
    expect(spy.mock.calls[0][0].checkinCodes).toEqual(['K7Q2MX', 'H4PN8R'])
    expect(sender.sent[0]).toMatchObject({ details: { checkinCode: 'K7Q2MX' }, image: qr.url })
  })

  it('a decline mints no code and sends no image', async () => {
    const id = await seed()
    const spy = vi.spyOn(requests, 'decide')
    await decideBookingRequest(deps, { restaurantId: A, userId: 'u', bookingId: id, decision: 'declined', reason: 'Full' })
    expect(spy.mock.calls[0][0].checkinCodes).toBeUndefined()
    expect(sender.sent[0]).not.toHaveProperty('image')
    expect(sender.sent[0].details).not.toHaveProperty('checkinCode')
  })
})

describe('the sender and the QR header (R10, AC-17, AC-18)', () => {
  const SAMPLE = 'https://storage.example/booking-checkin-qr/examples/checkin-qr-example.png'
  const LINK = 'https://storage.example/booking-checkin-qr/AbCdEfGhIjKlMnOpQrStUvWx.png'
  const qrTemplate = { id: 'tpl-qr', name: 'booking_confirmed_x', language: 'en', status: 'approved',
    components: bookingKindComponents('confirmed', bookingTemplateBody('confirmed', 'en'), SAMPLE) } as unknown as WhatsAppTemplate
  const oldTemplate = { id: 'tpl-old', name: 'booking_confirmed', language: 'en', status: 'approved',
    components: [{ type: 'BODY', text: 'Hi {{name}}, your booking at {{restaurant}} on {{date}} at {{time}} is confirmed.' }] } as unknown as WhatsAppTemplate
  const input = (image?: string | null) => ({
    restaurantId: A, phone: '+85291234567', memberId: null, kind: 'confirmed' as const,
    details: { restaurantName: 'Kushiro', name: 'Chan', date: '2026-11-28', time: '19:30', partySize: 2, checkinCode: 'K7Q2MX' },
    ...(image !== undefined ? { image } : {}),
  })
  let deps: { [K in keyof BookingSenderDeps]-?: ReturnType<typeof vi.fn> }

  function withTemplate(t: WhatsAppTemplate | null, windowOpen = false) {
    deps = {
      getConfig: vi.fn().mockResolvedValue({ ...DEFAULT_BOOKING_CONFIG, templateIds: { ...DEFAULT_BOOKING_CONFIG.templateIds, confirmed: { en: t?.id ?? null, zh_hk: null } } }),
      findTemplates: vi.fn(async () => (t ? [t] : [])),
      promoteCandidate: vi.fn(),
      getPhoneNumberId: vi.fn().mockResolvedValue('pn-1'),
      isWindowOpen: vi.fn().mockResolvedValue(windowOpen),
      getLanguage: vi.fn().mockResolvedValue('en'),
      sendTemplate: vi.fn().mockResolvedValue({ ok: true, kapsoMessageId: 'w1', raw: null }),
      sendText: vi.fn().mockResolvedValue({ ok: true, kapsoMessageId: 'w2', raw: null }),
      sendImage: vi.fn().mockResolvedValue({ ok: true, kapsoMessageId: 'w3', raw: null }),
    }
  }
  const send = (i: ReturnType<typeof input>) => createBookingMessageSender(deps as unknown as BookingSenderDeps).send(i)

  it('a QR template sends the booking\'s own QR link as the header and the code as {{code}}', async () => {
    withTemplate(qrTemplate)
    expect(await send(input(LINK))).toEqual({ delivered: true, via: 'template' })
    const args = deps.sendTemplate.mock.calls[0][0]
    expect(args.headerImageLink).toBe(LINK)
    expect(args.paramValues.code).toBe('K7Q2MX')
  })

  it('a QR template without the booking\'s link is not delivered (never the sample image)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    withTemplate(qrTemplate)
    expect((await send(input(null))).delivered).toBe(false)
    expect(deps.sendTemplate).not.toHaveBeenCalled()
  })

  it('AC-18: an old approved confirmed (no QR) still sends, without a header link', async () => {
    withTemplate(oldTemplate)
    expect(await send(input(LINK))).toEqual({ delivered: true, via: 'template' })
    expect(deps.sendTemplate.mock.calls[0][0].headerImageLink).toBeUndefined()
  })

  it('inside the window without an approved template: an image with the text (code included) as caption', async () => {
    withTemplate(null, true)
    expect(await send(input(LINK))).toEqual({ delivered: true, via: 'image' })
    const [, to, link, caption] = deps.sendImage.mock.calls[0]
    expect(to).toBe('+85291234567')
    expect(link).toBe(LINK)
    expect(caption).toContain('K7Q2MX')
    expect(deps.sendText).not.toHaveBeenCalled()
  })
})
