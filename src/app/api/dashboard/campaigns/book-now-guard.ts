/**
 * BOOK-001 W3: Book now fields on the campaign create/update API.
 * Parses `bookNowEnabled` / `bookingUrl` (R14) and refuses a combination the
 * send could not honour, as a 400 the campaign form shows inline.
 */
import { CampaignBodyError } from './parse-create-body-errors'
import { parseCampaignBookingUrl, BOOK_NOW_ISSUE_MESSAGES } from '@/domain/services/campaign-book-now'
import { campaignBookNowIssue, type CampaignBookNowInput } from '@/application/booking/campaign-book-now-check'
import { findByIdForRestaurant } from '@/infrastructure/supabase/repositories/whatsapp-template-repository'
import { getBookingConfig } from '@/infrastructure/supabase/repositories/booking-config-repository'
import { appBaseUrl } from '@/infrastructure/config/app-url'

export interface BookNowFields {
  bookNowEnabled?: boolean
  bookingUrl?: string | null
}

const INVALID_URL = 'bookingUrl must be an https:// link with a host, 2,048 characters or fewer'

/** Only the keys the body carries; an invalid value is a 400. */
export function parseBookNowFields(body: Record<string, unknown>): BookNowFields {
  const fields: BookNowFields = {}
  if (body.bookNowEnabled !== undefined) {
    if (typeof body.bookNowEnabled !== 'boolean') throw new CampaignBodyError(400, 'bookNowEnabled must be a boolean')
    fields.bookNowEnabled = body.bookNowEnabled
  }
  if (body.bookingUrl !== undefined) {
    const parsed = parseCampaignBookingUrl(body.bookingUrl)
    if (!parsed.ok) throw new CampaignBodyError(400, INVALID_URL)
    fields.bookingUrl = parsed.value
  }
  return fields
}

/** Throws a 400 CampaignBodyError naming the problem, or returns. */
export async function assertCampaignBookNow(input: CampaignBookNowInput): Promise<void> {
  const issue = await campaignBookNowIssue(input, {
    findTemplate: findByIdForRestaurant,
    getConfig: getBookingConfig,
    appUrl: appBaseUrl(),
  })
  if (issue) throw new CampaignBodyError(400, BOOK_NOW_ISSUE_MESSAGES[issue])
}
