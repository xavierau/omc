/**
 * BOOK-001 W3 (AC-16/AC-17): checks a campaign's Book now settings against
 * its template and the restaurant's booking config before create/update.
 *
 * The template is looked up scoped to the session restaurant, so another
 * tenant's template id reads as "no Book now button" (memory:
 * principle_authorize_by_scoped_query). The booking config is read only when
 * the toggle is on.
 */
import { templateHasBookNowButton } from '@/domain/services/book-now-button'
import { bookNowIssue, type BookNowIssue } from '@/domain/services/campaign-book-now'
import type { WhatsAppTemplate } from '@/domain/entities/whatsapp-template'
import type { BookingConfig } from '@/domain/value-objects/booking-config'

export interface CampaignBookNowInput {
  restaurantId: string
  enabled: boolean
  templateId: string | null
  bookingUrl: string | null
}

export interface CampaignBookNowDeps {
  findTemplate(id: string, restaurantId: string): Promise<WhatsAppTemplate | null>
  getConfig(restaurantId: string): Promise<BookingConfig>
  appUrl: string
}

export async function campaignBookNowIssue(
  input: CampaignBookNowInput,
  deps: CampaignBookNowDeps
): Promise<BookNowIssue | null> {
  const template = input.templateId
    ? await deps.findTemplate(input.templateId, input.restaurantId)
    : null
  const config = input.enabled ? await deps.getConfig(input.restaurantId) : null
  return bookNowIssue({
    enabled: input.enabled,
    templateHasButton: templateHasBookNowButton(template, deps.appUrl),
    bookingUrl: input.bookingUrl,
    mode: config?.mode ?? 'off',
    externalUrl: config?.externalUrl ?? null,
  })
}
