import { isDeliveryUnknownReason } from './campaign-delivery-failure-reason'

export type RerunBlock = 'welcome' | 'not_failed' | 'delivery_unknown'

export interface RerunSubject {
  type: string
  status: string
  failureReason?: string | null
}

/**
 * CAMP-014: why a campaign cannot be re-run, or null when it can. One rule for
 * the /rerun route and the card, so the button is never offered for a request
 * the route refuses. Welcome campaigns fire on member join, and a
 * delivery-unknown failure may already have reached customers.
 */
export function rerunBlock(campaign: RerunSubject): RerunBlock | null {
  if (campaign.type === 'welcome') return 'welcome'
  if (campaign.status !== 'failed') return 'not_failed'
  if (isDeliveryUnknownReason(campaign.failureReason)) return 'delivery_unknown'
  return null
}
