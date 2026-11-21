// BOOK-009 F1 (review P2-1 ruling, spec AC-5): the booking page view model
// with the schedule switch off: the BOOK-001 form (no schedule) plus the
// details (terms, info, table time) when set; nothing set → as hours null.
import { describe, it, expect, beforeEach } from 'vitest'
import { resolveBookingLink, type ResolveBookingLinkDeps } from '../resolve-booking-link'
import { FakeBookingSettings, FakeBookingTokens } from '@/test-utils/fake-booking'
import { EMPTY_BOOKING_HOURS, type BookingHours } from '@/domain/value-objects/booking-hours'

const A = 'rest-a'
const TOKEN = 'A'.repeat(43)
const NOW = new Date('2026-11-12T02:00:00.000Z')
const OFF: BookingHours = { ...EMPTY_BOOKING_HOURS, scheduleEnabled: false }
const TERMS = { zh_hk: '', en: 'No pets' }

let settings: FakeBookingSettings
let deps: ResolveBookingLinkDeps

beforeEach(() => {
  const tokens = new FakeBookingTokens()
  tokens.add({ token: TOKEN, restaurantId: A, phone: '+85291234567', source: 'chat', campaignId: null })
  settings = new FakeBookingSettings()
  settings.restaurants.set(A, { name: 'Kushiro', logoUrl: null, whatsappNumber: '+85220000001' })
  deps = { tokens, settings, now: () => NOW }
})

describe('resolveBookingLink with the schedule switch off', () => {
  it('terms only (every day "closed" underneath) → the form, not the off page, with the terms as details', async () => {
    settings.setConfig(A, { mode: 'simple', bookingHours: { ...OFF, terms: TERMS } })
    const view = await resolveBookingLink(deps, TOKEN)
    expect(view).toMatchObject({ kind: 'form', details: { terms: TERMS, tableMinutes: null } })
    expect('schedule' in view).toBe(false)
  })

  it('nothing set → exactly the hours-null view (no schedule, no details)', async () => {
    settings.setConfig(A, { mode: 'simple', bookingHours: OFF })
    const off = await resolveBookingLink(deps, TOKEN)
    settings.setConfig(A, { mode: 'simple', bookingHours: null })
    expect(off).toEqual(await resolveBookingLink(deps, TOKEN))
  })

  it('switch on with no bookable time is still the off page', async () => {
    settings.setConfig(A, { mode: 'simple', bookingHours: { ...EMPTY_BOOKING_HOURS, terms: TERMS } })
    expect(await resolveBookingLink(deps, TOKEN)).toMatchObject({ kind: 'unavailable', reason: 'off' })
  })
})
