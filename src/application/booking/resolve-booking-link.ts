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
 */
import { buildContactUrl } from '@/domain/services/contact-redirect'
import { hongKongToday } from '@/domain/services/booking-submission'
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
  return {
    kind: 'form',
    restaurant: { name: restaurant.name, logoUrl: restaurant.logoUrl },
    maskedPhone: maskDinerPhone(owner.phone),
    maxPartySize: config.maxPartySize,
    today: hongKongToday(deps.now()),
    retryUrl: retryUrlOf(restaurant),
  }
}
