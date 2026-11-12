import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('next-intl', () => ({
  useTranslations: (ns: string) => (key: string, vars?: Record<string, unknown>) =>
    vars ? `${ns}.${key}:${JSON.stringify(vars)}` : `${ns}.${key}`,
}))

import { BookingFormNotice, BookingSent } from '../booking-form'
import { BookingFormFields } from '../booking-form-fields'
import { BookingUnavailable } from '../booking-unavailable'
import { outcomeFromResponse } from '../booking-form-client'

const values = { date: '2026-11-13', time: '19:30', partySize: '4', name: 'Chan', notes: '' }

describe('booking page UI states (spec UI Feedback States)', () => {
  it('maps API answers to page states', () => {
    expect(outcomeFromResponse(200, { ok: true, delivered: false })).toEqual({ kind: 'sent' })
    expect(outcomeFromResponse(400, { error: 'invalid', fields: { date: 'past' } })).toEqual({
      kind: 'fields',
      errors: { date: 'past' },
    })
    expect(outcomeFromResponse(410, { state: 'consumed' })).toEqual({ kind: 'gone', state: 'consumed' })
    expect(outcomeFromResponse(409, {})).toEqual({ kind: 'too_many' })
    expect(outcomeFromResponse(429, {})).toEqual({ kind: 'rate_limited' })
    expect(outcomeFromResponse(500, null)).toEqual({ kind: 'error' })
  })

  it('a delivered:false submit still shows Request sent (the request is safe)', () => {
    expect(outcomeFromResponse(200, { ok: true, delivered: false }).kind).toBe('sent')
    expect(renderToStaticMarkup(<BookingSent />)).toContain('data-testid="booking-sent"')
  })

  it('shows a field error next to its field, with the max for party size', () => {
    const html = renderToStaticMarkup(
      <BookingFormFields values={values} errors={{ date: 'past', partySize: 'too_large' }} today="2026-11-12" maxPartySize={20} onChange={() => {}} />
    )
    expect(html).toContain('data-testid="booking-field-error-date"')
    expect(html).toContain('booking.errors.past')
    expect(html).toContain('booking.errors.too_large:{&quot;max&quot;:20}')
    expect(html).toContain('aria-invalid="true"')
    expect(html).toContain('min="2026-11-12"')
  })

  it('shows form-level notices for too many pending, rate limit and failure', () => {
    expect(renderToStaticMarkup(<BookingFormNotice outcome={{ kind: 'too_many' }} />)).toContain('booking.tooManyPending')
    expect(renderToStaticMarkup(<BookingFormNotice outcome={{ kind: 'rate_limited' }} />)).toContain('booking.rateLimited')
    expect(renderToStaticMarkup(<BookingFormNotice outcome={{ kind: 'error' }} />)).toContain('booking.submitFailed')
    expect(renderToStaticMarkup(<BookingFormNotice outcome={null} />)).toBe('')
  })

  it('a used link offers the WhatsApp BOOK link', () => {
    const html = renderToStaticMarkup(<BookingUnavailable reason="consumed" retryUrl="https://wa.me/852?text=BOOK" />)
    expect(html).toContain('booking.consumedTitle')
    expect(html).toContain('href="https://wa.me/852?text=BOOK"')
  })

  // F11: the 410 for booking switched off carries state off → the off page.
  it('a 410 booking_unavailable maps to the off state', () => {
    expect(outcomeFromResponse(410, { error: 'booking_unavailable', state: 'off' })).toEqual({ kind: 'gone', state: 'off' })
  })

  // F14 (I1 FYI): booking off promises no new link; it says online booking is
  // not available and to message the restaurant. The Ask on WhatsApp button
  // stays where it was (a restaurant number is known); no "send BOOK" line.
  it('booking off: the off copy, the WhatsApp button when there is a number, never the new-link line', () => {
    const withNumber = renderToStaticMarkup(<BookingUnavailable reason="off" retryUrl="https://wa.me/852?text=BOOK" />)
    expect(withNumber).toContain('booking.offTitle')
    expect(withNumber).toContain('booking.offBody')
    expect(withNumber).not.toContain('booking.unavailableBody')
    expect(withNumber).toContain('data-testid="booking-ask-whatsapp"')
    const noNumber = renderToStaticMarkup(<BookingUnavailable reason="off" retryUrl={null} />)
    expect(noNumber).toContain('booking.offBody')
    expect(noNumber).not.toContain('booking.askOnWhatsappManual')
  })

  it('booking off copy in both locales mentions no new link', async () => {
    for (const locale of ['en', 'zh-HK']) {
      const m = (await import(`@/messages/${locale}.json`)).default as { booking: Record<string, string> }
      expect(m.booking.offBody, locale).toBeTruthy()
      expect(m.booking.offBody, locale).not.toMatch(/new link|新連結/i)
    }
  })

  // F6: the time field error for a time already past today has copy in both locales.
  it('has past_time copy in both locales', async () => {
    for (const locale of ['en', 'zh-HK']) {
      const m = (await import(`@/messages/${locale}.json`)).default as { booking: { errors: Record<string, string> } }
      expect(m.booking.errors.past_time, locale).toBeTruthy()
    }
  })
})
