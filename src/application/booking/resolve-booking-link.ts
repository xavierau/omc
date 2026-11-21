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
 * F1 (P2-1): with the schedule switch off the page is the BOOK-001 date/time
 * form, plus `details` (terms with their tick, info, table time) when set.
 *
 * BOOK-010 (spec AC-12): the schedule also carries `room`, read from the
 * guest counts and staff stops for today..window end and decided by the
 * shared rule (`fitsFor`, the same one every channel's server check uses):
 * per date and slot, the largest party that still fits, listed only where
 * it is below the restaurant's max party. The page only compares a party
 * against it; it never counts. The submit check stays the authority.
 * Schedule off → no room (I-010: room rules follow the schedule switch).
 */
import { buildContactUrl } from '@/domain/services/contact-redirect'
import { hongKongTime, hongKongToday } from '@/domain/services/booking-submission'
import { slotsFor, windowEnd, type BookingClock } from '@/domain/services/booking-hours'
import { fitsFor, roomApplies, type RoomState } from '@/domain/services/booking-room'
import { addDays } from '@/domain/services/booking-calendar'
import { activeSchedule, bookingHoursInEffect, type BookingHours } from '@/domain/value-objects/booking-hours'
import type { BookingTokenState } from '@/domain/services/booking-token'
import type { BookingConfig } from '@/domain/value-objects/booking-config'
import type { BookingRestaurantContext, BookingRoomReader, BookingSettingsReader, BookingTokenOwner, BookingTokenStore } from '@/domain/ports/booking'

/** One of W2's BOOK keywords, prefilled in the recovery deep link. */
export const BOOK_KEYWORD = 'BOOK'

export interface ResolveBookingLinkDeps {
  tokens: Pick<BookingTokenStore, 'peek'>
  settings: BookingSettingsReader
  now(): Date
  /** BOOK-010: guest counts and stops; absent = no 已滿 states (the submit check still refuses). */
  room?: BookingRoomReader
}

/** BOOK-010: date → HH:MM → the largest party that fits now; a slot not listed fits any allowed party. */
export type SlotRoom = Record<string, Record<string, number>>

export interface BookingPageRestaurant {
  name: string
  logoUrl: string | null
}

export type BookingPageDetails = Pick<BookingHours, 'terms' | 'info' | 'tableMinutes'>

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
      schedule?: { hours: BookingHours; nowTime: string; room?: SlotRoom }
      /** F1 (P2-1): schedule off but terms, info or table time set; the BOOK-001 form shows them. */
      details?: BookingPageDetails
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

/** The largest party in 0..max that `fits` (fits is monotone: a smaller party fits wherever a larger one does). */
function largestFit(fits: (party: number) => boolean, max: number): number {
  if (fits(max)) return max
  let lo = 0
  let hi = max
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2)
    if (fits(mid)) lo = mid
    else hi = mid
  }
  return lo
}

function slotRoomOf(hours: BookingHours, state: RoomState, clock: BookingClock, maxParty: number): SlotRoom {
  const room: SlotRoom = {}
  for (let d = clock.today; d <= windowEnd(hours, clock.today); d = addDays(d, 1)) {
    for (const { time } of slotsFor(hours, d, clock)) {
      const max = largestFit((party) => fitsFor(hours, state, party)(d, time), maxParty)
      if (max < maxParty) (room[d] ??= {})[time] = max
    }
  }
  return room
}

/** BOOK-010: the page's room, or undefined without a reader or when the read fails (the page still works). */
async function readSlotRoom(deps: Pick<ResolveBookingLinkDeps, 'room'>, restaurantId: string, config: BookingConfig, clock: BookingClock) {
  const hours = config.bookingHours
  if (!deps.room || !roomApplies(hours)) return undefined
  try {
    const state = await deps.room.readRoom(restaurantId, clock.today, windowEnd(hours, clock.today))
    return slotRoomOf(hours, state, clock, config.maxPartySize)
  } catch (error) {
    console.warn('[Booking] room read failed; page shown without full states:', (error as Error).message)
    return undefined
  }
}

async function formView(
  deps: Pick<ResolveBookingLinkDeps, 'now' | 'room'>,
  restaurantId: string,
  restaurant: BookingRestaurantContext,
  config: BookingConfig,
  maskedPhone: string
): Promise<BookingLinkView> {
  const now = deps.now()
  const clock = { today: hongKongToday(now), nowTime: hongKongTime(now) }
  const schedule = activeSchedule(config.bookingHours)
  const inEffect = bookingHoursInEffect(config.bookingHours)
  if (schedule && !anyBookableTime(schedule, clock)) return unavailable('off', restaurant)
  const room = await readSlotRoom(deps, restaurantId, config, clock)
  const view: FormView = {
    kind: 'form',
    restaurant: { name: restaurant.name, logoUrl: restaurant.logoUrl },
    maskedPhone,
    maxPartySize: config.maxPartySize,
    today: clock.today,
    retryUrl: retryUrlOf(restaurant),
    ...(schedule ? { schedule: { hours: schedule, nowTime: clock.nowTime, ...(room ? { room } : {}) } } : {}),
    ...(!schedule && inEffect ? { details: { terms: inEffect.terms, info: inEffect.info, tableMinutes: inEffect.tableMinutes } } : {}),
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
  return formView(deps, restaurantId, restaurant, config, PREVIEW_MASKED_PHONE)
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
  return formView(deps, owner.restaurantId, restaurant, config, maskDinerPhone(owner.phone))
}
