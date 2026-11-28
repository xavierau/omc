// BOOK-009 W3: the booking page view model with booking hours (AC-5, AC-6) and the admin Preview (S1.10).
import { describe, it, expect, beforeEach } from 'vitest'
import { PREVIEW_MASKED_PHONE, previewBookingView, resolveBookingLink, type ResolveBookingLinkDeps } from '../booking/resolve-booking-link'
import { FakeBookingSettings, FakeBookingTokens } from '@/test-utils/fake-booking'
import { EMPTY_BOOKING_HOURS, type BookingHours } from '@/domain/value-objects/booking-hours'

const A = 'rest-a'
const TOKEN = 'A'.repeat(43)
// 2026-11-12 10:00 HK
const NOW = new Date('2026-11-12T02:00:00.000Z')
const DINNER = [{ first: '18:00', last: '21:00' }]
const HOURS: BookingHours = { ...EMPTY_BOOKING_HOURS, weekly: { ...EMPTY_BOOKING_HOURS.weekly, fri: DINNER, sat: DINNER } }

let tokens: FakeBookingTokens
let settings: FakeBookingSettings
let deps: ResolveBookingLinkDeps

beforeEach(() => {
  tokens = new FakeBookingTokens()
  tokens.add({ token: TOKEN, restaurantId: A, phone: '+85291234567', source: 'chat', campaignId: null })
  settings = new FakeBookingSettings()
  settings.restaurants.set(A, { name: 'Kushiro', logoUrl: null, whatsappNumber: '+85220000001' })
  settings.setConfig(A, { mode: 'simple', maxPartySize: 8, bookingHours: HOURS })
  deps = { tokens, settings, now: () => NOW }
})

describe('resolveBookingLink with booking hours', () => {
  it('carries the hours and the HK clock for the slot picker', async () => {
    const view = await resolveBookingLink(deps, TOKEN)
    expect(view).toMatchObject({ kind: 'form', today: '2026-11-12', schedule: { hours: HOURS, nowTime: '10:00' } })
  })

  it('AC-5: no hours → no schedule (the BOOK-001 form)', async () => {
    settings.setConfig(A, { mode: 'simple', bookingHours: null })
    const view = await resolveBookingLink(deps, TOKEN)
    expect(view.kind).toBe('form')
    expect('schedule' in view).toBe(false)
  })

  it('hours with no bookable time in the window → the off page (spec UI Feedback States)', async () => {
    settings.setConfig(A, { mode: 'simple', bookingHours: EMPTY_BOOKING_HOURS })
    expect(await resolveBookingLink(deps, TOKEN)).toMatchObject({ kind: 'unavailable', reason: 'off' })
  })
})

describe('previewBookingView (S1.10)', () => {
  it('the saved settings with the placeholder phone, no token needed', async () => {
    const view = await previewBookingView(deps, A)
    expect(view).toMatchObject({ kind: 'form', maskedPhone: PREVIEW_MASKED_PHONE, maxPartySize: 8, schedule: { hours: HOURS } })
    expect(PREVIEW_MASKED_PHONE).not.toMatch(/\d/)
  })

  it('previews Simple settings even while the mode is off; unknown restaurant → off page', async () => {
    settings.setConfig(A, { mode: 'off', bookingHours: HOURS })
    expect((await previewBookingView(deps, A)).kind).toBe('form')
    expect(await previewBookingView(deps, 'nope')).toMatchObject({ kind: 'unavailable', reason: 'off' })
  })
})
