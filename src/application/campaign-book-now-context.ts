import type { Campaign } from '@/domain/entities/campaign'
import type { Member } from '@/domain/entities/member'
import type { BookingConfig } from '@/domain/value-objects/booking-config'
import type { SendResult } from '@/domain/value-objects/send-result'
import { mintBookingToken } from '@/infrastructure/supabase/repositories/booking-token-repository'

/**
 * BOOK-001 W3 (AC-16): what a Book now campaign run needs to mint links.
 * Read once at run start, like the pacing config. The token is minted
 * whatever the current booking mode: /b/<token> resolves the mode when the
 * diner taps (plan#domain-model, unified link).
 */
export interface BookNowSendContext {
  /** booking_config.campaignLinkTtlHours; null = no expiry. */
  ttlHours: number | null
}

export async function bookNowSendContext(
  campaign: Campaign,
  getConfig: (restaurantId: string) => Promise<BookingConfig>
): Promise<BookNowSendContext | null> {
  if (!campaign.bookNowEnabled) return null
  const config = await getConfig(campaign.restaurantId)
  return { ttlHours: config.campaignLinkTtlHours }
}

/** A send we refuse: a Book now button with no token would be a dead link. */
export const BOOK_NOW_LINK_UNAVAILABLE: SendResult = {
  ok: false,
  kapsoMessageId: null,
  raw: null,
  error: { title: 'book_now_link_unavailable' },
}

/** The recipient's own `campaign` booking token, or null when minting failed. */
export function mintCampaignBookingToken(
  campaign: Campaign,
  member: Member,
  bookNow: BookNowSendContext
): Promise<string | null> {
  return mintBookingToken({
    restaurantId: campaign.restaurantId,
    phone: member.phone,
    source: 'campaign',
    campaignId: campaign.id,
    ttlHours: bookNow.ttlHours,
  })
}
