import { describe, it, expect, vi, afterEach } from 'vitest'
import { bookingDecisionOutcome, decideBooking, noticeFor } from '@/hooks/use-bookings'
import { needsExternalUrl, saveOutcome, toForm, toPayload } from '@/hooks/use-booking-settings'
import { DEFAULT_BOOKING_CONFIG } from '@/domain/value-objects/booking-config'

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
