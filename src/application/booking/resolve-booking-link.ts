/**
 * BOOK-001: what `/b/<token>` shows, by the restaurant's CURRENT mode.
 *
 *  - simple + valid token  -> the booking form;
 *  - external + valid token -> redirect to the campaign's booking URL (via the
 *    token's campaign, scoped to its restaurant) or the restaurant default.
 *    The target comes only from stored data, never from the request (R15);
 *  - off, no target, expired, used or unknown -> an explanation page with a
 *    wa.me link that sends BOOK to the restaurant (spec AC-12), no form.
 *
 * The token is only peeked: opening a page is not submitting one.
 *
 * BOOK-009: the form view carries the restaurant's booking hours (null = not
 * configured: today's date/time form, AC-5) and the Hong Kong clock, so the
 * page computes days and slots with the same pure `slotsFor` the server
 * checks with. Hours that leave no bookable time in the window → the off page.
 * `previewBookingView` builds the admin Preview from the SAVED config (S1.10).
 */
import { buildContactUrl } from '@/domain/services/contact-redirect'
import { hongKongTime, hongKongToday } from '@/domain/services/booking-submission'
import { slotsFor, windowEnd } from '@/domain/services/booking-hours'
import { addDays } from '@/domain/services/booking-calendar'
import type { BookingHours } from '@/domain/value-objects/booking-hours'
import type { BookingTokenState } from '@/domain/services/booking-token'
import type { BookingConfig } from '@/domain/value-objects/booking-config'
import type { BookingRestaurantContext, BookingSettingsReader, BookingTokenOwner, BookingTokenStore } from '@/domain/ports/booking'

/** One of W2's BOOK keywords, prefilled in the recovery deep link. */
export const BOOK_KEYWORD = 'BOOK'

export interface ResolveBookingLinkDeps {
  tokens: Pick<BookingTokenStore, 'peek'>
  settings: BookingSettingsReader
  now(): Date
}

export interface BookingPageRestaurant {
  name: string
  logoUrl: string | null
}

export type BookingLinkView =
  | {
      kind: 'form'
      restaurant: BookingPageRestaurant
      maskedPhone: string
      maxPartySize: number
      today: string
      /**
       * BOOK-009: set only when the restaurant has booking hours (absent = the
       * BOOK-001 date/time form, unchanged, AC-5), with Hong Kong now (HH:MM).
       */
      schedule?: { hours: BookingHours; nowTime: string }
      retryUrl: string | null
    }
  | { kind: 'redirect'; url: string }
  | {
      kind: 'unavailable'
      reason: Exclude<BookingTokenState, 'valid'> | 'off'
      restaurant: BookingPageRestaurant | null
      retryUrl: string | null
    }

/** Last four digits only (R10). */
export function maskDinerPhone(phone: string): string {
  return `•••• ${phone.replace(/\D/g, '').slice(-4)}`
}

function retryUrlOf(restaurant: BookingRestaurantContext | null): string | null {
  return restaurant?.whatsappNumber ? buildContactUrl(restaurant.whatsappNumber, BOOK_KEYWORD) : null
}

function unavailable(
  reason: Exclude<BookingTokenState, 'valid'> | 'off',
  restaurant: BookingRestaurantContext | null
): BookingLinkView {
  return {
    kind: 'unavailable',
    reason,
    restaurant: restaurant ? { name: restaurant.name, logoUrl: restaurant.logoUrl } : null,
    retryUrl: retryUrlOf(restaurant),
  }
}

async function externalTarget(deps: ResolveBookingLinkDeps, owner: BookingTokenOwner, config: BookingConfig) {
  const campaignUrl = owner.campaignId ? await deps.settings.getCampaignBookingUrl(owner.campaignId, owner.restaurantId) : null
  return campaignUrl ?? config.externalUrl
}

/** Whether any day in the window still has a slot. */
function anyBookableTime(hours: BookingHours, clock: { today: string; nowTime: string }): boolean {
  for (let d = clock.today; d <= windowEnd(hours, clock.today); d = addDays(d, 1)) {
    if (slotsFor(hours, d, clock).length > 0) return true
  }
  return false
}

type FormView = Extract<BookingLinkView, { kind: 'form' }>

function formView(deps: Pick<ResolveBookingLinkDeps, 'now'>, restaurant: BookingRestaurantContext, config: BookingConfig, maskedPhone: string): BookingLinkView {
  const now = deps.now()
  const clock = { today: hongKongToday(now), nowTime: hongKongTime(now) }
  if (config.bookingHours && !anyBookableTime(config.bookingHours, clock)) return unavailable('off', restaurant)
  const view: FormView = {
    kind: 'form',
    restaurant: { name: restaurant.name, logoUrl: restaurant.logoUrl },
    maskedPhone,
    maxPartySize: config.maxPartySize,
    today: clock.today,
    retryUrl: retryUrlOf(restaurant),
    ...(config.bookingHours ? { schedule: { hours: config.bookingHours, nowTime: clock.nowTime } } : {}),
  }
  return view
}

/** Spec S1.10: what the masked number reads as in the admin Preview. */
export const PREVIEW_MASKED_PHONE = '•••• ••••'

/**
 * BOOK-009 S1.10: the diner page for the admin's own restaurant with its
 * SAVED settings, whatever the mode (no token; the page disables submit).
 */
export async function previewBookingView(deps: Omit<ResolveBookingLinkDeps, 'tokens'>, restaurantId: string): Promise<BookingLinkView> {
  const [restaurant, config] = await Promise.all([deps.settings.getRestaurant(restaurantId), deps.settings.getConfig(restaurantId)])
  if (!restaurant) return unavailable('off', null)
  return formView(deps, restaurant, config, PREVIEW_MASKED_PHONE)
}

export async function resolveBookingLink(deps: ResolveBookingLinkDeps, token: string): Promise<BookingLinkView> {
  const { state, owner } = await deps.tokens.peek(token, deps.now())
  if (!owner) return unavailable('unknown', null)
  const restaurant = await deps.settings.getRestaurant(owner.restaurantId)
  if (state !== 'valid') return unavailable(state, restaurant)

  const config = await deps.settings.getConfig(owner.restaurantId)
  if (config.mode === 'external') {
    const url = await externalTarget(deps, owner, config)
    return url ? { kind: 'redirect', url } : unavailable('off', restaurant)
  }
  if (config.mode !== 'simple' || !restaurant) return unavailable('off', restaurant)
  return formView(deps, restaurant, config, maskDinerPhone(owner.phone))
}
