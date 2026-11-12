import { describe, it, expect, vi, afterEach } from 'vitest'
import { bookingDecisionOutcome, decideBooking, noticeFor } from '@/hooks/use-bookings'
import { needsExternalUrl, saveOutcome, toForm, toPayload } from '@/hooks/use-booking-settings'
import { DEFAULT_BOOKING_CONFIG, parseBookingSettings } from '@/domain/value-objects/booking-config'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('use-bookings helpers', () => {
  it('maps decision answers', () => {
    const booking = { id: 'b1', status: 'confirmed' }
    expect(bookingDecisionOutcome(200, { booking, delivered: false })).toEqual({ kind: 'done', booking, delivered: false })
    expect(bookingDecisionOutcome(409, { status: 'declined' })).toEqual({ kind: 'already_handled', status: 'declined' })
    expect(bookingDecisionOutcome(404, {})).toEqual({ kind: 'not_found' })
    expect(bookingDecisionOutcome(500, null)).toEqual({ kind: 'error' })
  })

  it('posts confirm/decline to the scoped endpoint with the reason only on decline', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ status: 404, json: async () => ({}) })
    vi.stubGlobal('fetch', fetchMock)
    await decideBooking('b1', 'decline', 'Full')
    expect(fetchMock).toHaveBeenCalledWith('/api/dashboard/bookings/b1/decline', expect.objectContaining({ body: '{"reason":"Full"}' }))
    await decideBooking('b1', 'confirm')
    expect(fetchMock.mock.calls[1][1].body).toBe('{}')
  })

  // I1 seam bug: a saved decision whose WhatsApp message was not delivered
  // showed "Confirmation sent" next to the "Message not delivered" badge.
  it('says sent only when the message was delivered (spec warning row)', () => {
    expect(noticeFor('confirm', { kind: 'done', booking: {} as never, delivered: false })).toBeNull()
    expect(noticeFor('decline', { kind: 'done', booking: {} as never, delivered: false })).toBeNull()
  })

  // I1: zh-HK rendered '已已拒絕'. F14: en rendered 'already Declined' (the
  // status badge word, capitalised). The notice has its own status words.
  it('reads the already-handled notice naturally in both locales', async () => {
    const line = async (locale: string, status: string) => {
      const m = (await import(`@/messages/${locale}.json`)).default as {
        bookings: { alreadyHandled: string; alreadyHandledStatus: Record<string, string> }
      }
      return m.bookings.alreadyHandled.replace('{status}', m.bookings.alreadyHandledStatus[status])
    }
    expect(await line('en', 'declined')).toBe('This request was already declined.')
    expect(await line('en', 'confirmed')).toBe('This request was already confirmed.')
    for (const status of ['confirmed', 'declined']) {
      const zh = await line('zh-HK', status)
      expect(zh).not.toContain('已已')
      expect(zh).toMatch(/^此要求已(確認|拒絕)。$/)
    }
  })

  it('turns outcomes into notices', () => {
    expect(noticeFor('confirm', { kind: 'done', booking: {} as never, delivered: true })).toEqual({ kind: 'sent', decision: 'confirm' })
    expect(noticeFor('decline', { kind: 'already_handled', status: 'confirmed' })).toEqual({ kind: 'already_handled', status: 'confirmed' })
    expect(noticeFor('decline', { kind: 'not_found' })).toEqual({ kind: 'error' })
  })
})

describe('use-booking-settings helpers', () => {
  it('round-trips a config with no expiry to a null payload', () => {
    const form = toForm({ ...DEFAULT_BOOKING_CONFIG, mode: 'simple', chatLinkTtlHours: null })
    expect(form.chatLinkNoExpiry).toBe(true)
    expect(toPayload(form)).toEqual({
      mode: 'simple', externalUrl: null, chatLinkTtlHours: null, campaignLinkTtlHours: 168, maxPartySize: 20,
    })
  })

  // I1 seam bug: an invalid URL typed in External mode stayed in the hidden
  // field after switching to Simple/Off; the save then failed on a URL error
  // that those modes do not render, so Simple could never be saved.
  it('outside External mode sends only a valid stored URL, never an invalid draft', () => {
    const base = toForm(DEFAULT_BOOKING_CONFIG)
    expect(toPayload({ ...base, mode: 'simple', externalUrl: 'http://not-https.test' }).externalUrl).toBeNull()
    expect(toPayload({ ...base, mode: 'off', externalUrl: 'javascript:alert(1)' }).externalUrl).toBeNull()
    expect(toPayload({ ...base, mode: 'simple', externalUrl: ' https://inline.app/r/1 ' }).externalUrl).toBe('https://inline.app/r/1')
    expect(toPayload({ ...base, mode: 'external', externalUrl: 'http://not-https.test' }).externalUrl).toBe('http://not-https.test')
  })

  // F1 (review #1): lifetimes and party size are shown only in Simple mode. A
  // draft left invalid there (0 hours) must not fail an Off or External save
  // on a field those modes do not render.
  it.each(['off', 'external'] as const)('Simple → 0 in a lifetime → %s → the save passes server validation', (mode) => {
    const saved = { ...DEFAULT_BOOKING_CONFIG, mode: 'simple' as const, chatLinkTtlHours: 48, maxPartySize: 12 }
    const form = { ...toForm(saved), chatLinkTtlHours: '0', campaignLinkTtlHours: '', maxPartySize: '0', mode, externalUrl: 'https://inline.app/r/1' }
    const result = parseBookingSettings(JSON.parse(JSON.stringify(toPayload(form))), saved)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.config).toMatchObject({ mode, chatLinkTtlHours: 48, campaignLinkTtlHours: 168, maxPartySize: 12 })
  })

  it('outside Simple mode still sends a valid lifetime and party size the admin entered', () => {
    const form = { ...toForm(DEFAULT_BOOKING_CONFIG), chatLinkTtlHours: '12', maxPartySize: '8', mode: 'off' as const }
    expect(toPayload(form)).toMatchObject({ chatLinkTtlHours: 12, maxPartySize: 8 })
  })

  it('in Simple mode an invalid lifetime is still sent so the server shows the field error', () => {
    const form = { ...toForm(DEFAULT_BOOKING_CONFIG), mode: 'simple' as const, chatLinkTtlHours: '0' }
    expect(toPayload(form).chatLinkTtlHours).toBe(0)
  })

  it('flags external mode without a URL', () => {
    expect(needsExternalUrl({ ...toForm(DEFAULT_BOOKING_CONFIG), mode: 'external' })).toBe(true)
    expect(needsExternalUrl({ ...toForm(DEFAULT_BOOKING_CONFIG), mode: 'external', externalUrl: 'https://x.io' })).toBe(false)
  })

  it('maps save answers', () => {
    // W3: a save also carries the template statuses (null when absent).
    expect(saveOutcome(200, { config: DEFAULT_BOOKING_CONFIG })).toEqual({ kind: 'saved', config: DEFAULT_BOOKING_CONFIG, templates: null })
    expect(saveOutcome(400, { fields: { externalUrl: 'invalid_https_url' } })).toEqual({
      kind: 'fields', errors: { externalUrl: 'invalid_https_url' },
    })
    expect(saveOutcome(403, {})).toEqual({ kind: 'forbidden' })
  })
})
