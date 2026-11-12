/**
 * BOOK-001 W3: what the campaign form shows for Book now, from the same
 * domain rules the API guard enforces (campaign-book-now.ts), so the form
 * warns before the server refuses.
 */
import { templateHasBookNowButton } from '@/domain/services/book-now-button'
import { bookNowIssue, bookNowToggleState, type BookNowIssue, type BookNowToggleState } from '@/domain/services/campaign-book-now'
import type { BookingAvailability } from '@/hooks/use-booking-availability'
import type { CampaignFormState, TemplateLookup } from './campaign-form-types'

export interface BookNowFormView {
  state: BookNowToggleState
  /** Toggle vs template mismatch; the no-link case is shown by `state`. */
  issue: Exclude<BookNowIssue, 'no_booking_link'> | null
  showUrl: boolean
  showPreview: boolean
}

type BookNowForm = Pick<CampaignFormState, 'bookNowEnabled' | 'bookingUrl' | 'messageType' | 'type'>

export function bookNowFormView(form: BookNowForm, lookup: TemplateLookup, availability: BookingAvailability | null): BookNowFormView {
  const template = form.messageType === 'wa_template' && lookup.status === 'resolved' ? lookup.template : null
  const templateHasButton = templateHasBookNowButton(template)
  const mode = availability?.mode ?? 'off'
  const externalUrl = availability?.externalUrl ?? null
  const campaignUrl = form.bookingUrl.trim() || null
  const welcome = form.type === 'welcome'
  const state = bookNowToggleState({ welcome, mode, externalUrl, campaignUrl, enabled: form.bookNowEnabled, templateHasButton })
  const known = lookup.status === 'resolved' || form.messageType === 'inline'
  const issue = known
    ? bookNowIssue({ welcome, enabled: form.bookNowEnabled, templateHasButton, bookingUrl: campaignUrl, mode, externalUrl })
    : null
  // With no link anywhere the toggle is disabled: "Add a booking link in
  // settings" is the one actionable message, not "turn on Book now".
  const shownIssue = issue === 'no_booking_link' || state === 'no_link' ? null : issue
  return {
    state,
    issue: shownIssue,
    showUrl: mode === 'external',
    showPreview: form.bookNowEnabled && templateHasButton,
  }
}
