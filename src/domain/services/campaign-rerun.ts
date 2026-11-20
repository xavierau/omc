import {
  isDeliveryUnknownReason,
  isNoServiceWindowReason,
} from './campaign-delivery-failure-reason'

export type RerunBlock = 'welcome' | 'not_failed' | 'delivery_unknown' | 'no_service_window'

export interface RerunSubject {
  type: string
  status: string
  failureReason?: string | null
}

/**
 * CAMP-014: why a campaign's fields rule out a re-run, or null when they do not.
 * One rule for the /rerun route and the card, so the card hides the button for
 * these cases. It is not the whole decision: the route also checks the campaign's
 * message rows and coupons (rerun-evidence-guard.ts), and that refusal shows
 * through the card's error display. Welcome campaigns fire on member join, a
 * delivery-unknown failure may already have reached customers, and a 131047
 * failure needs a new campaign, because this one's template cannot change.
 */
export function rerunBlock(campaign: RerunSubject): RerunBlock | null {
  if (campaign.type === 'welcome') return 'welcome'
  if (campaign.status !== 'failed') return 'not_failed'
  if (isDeliveryUnknownReason(campaign.failureReason)) return 'delivery_unknown'
  if (isNoServiceWindowReason(campaign.failureReason)) return 'no_service_window'
  return null
}
