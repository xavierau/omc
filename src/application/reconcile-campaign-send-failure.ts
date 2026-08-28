// #131: Meta can reject a campaign send AFTER the synchronous Cloud API ack,
// by which time the batch has already bumped the campaign's sent counter
// (the billing source of truth) and possibly marked the run `completed`.
// When the `failed` status webhook lands for a campaign BODY message, undo
// that count via the atomic `retract_campaign_sent` RPC (migration 064),
// which also flips a `completed` campaign whose counters drained to zero
// into `failed` with a tenant-visible reason — in the same statement.

import { retractCampaignSent } from '@/infrastructure/supabase/repositories/campaign-counters'
import { CAMPAIGN_BODY_MESSAGE_TYPES } from '@/infrastructure/supabase/repositories/whatsapp-message-campaign-queries'
import { deliveryFailureReason } from '@/domain/services/campaign-delivery-failure-reason'
import type { WhatsAppMessage } from '@/domain/entities/whatsapp-message'
import type { LogFn } from '@/domain/ports/whatsapp-webhooks'

export interface ReconcileArgs {
  /** Row as it was before this webhook was applied. */
  before: WhatsAppMessage
  /** Row after `applyStatusUpdate`. */
  after: WhatsAppMessage
  log: LogFn
}

const BODY_TYPES = new Set<string>(CAMPAIGN_BODY_MESSAGE_TYPES)

/**
 * Once-only guard (Amendment A3): the idempotency key is on the RAW status
 * string and `coerceStatus` maps unknown strings to `failed` with no error
 * code, so "this call flipped the row to failed" is the pre-image ≠ failed
 * AND post-image = failed AND errorCode present — not the claim alone.
 *
 * At-most-once (A4): any failure here is logged at `error` with the
 * campaignId (greppable over-count) and NEVER propagates — a thrown error
 * would 500 the webhook and make Kapso retry a claim we already burned.
 */
export async function reconcileCampaignSendFailure(
  args: ReconcileArgs
): Promise<void> {
  const before = args.before.snapshot
  const after = args.after.snapshot
  if (!after.campaignId) return
  if (before.status === 'failed' || after.status !== 'failed') return
  if (!after.errorCode) return
  // The coupon-QR image is never counted, so its failure never retracts.
  if (!BODY_TYPES.has(after.messageType)) return

  const context = {
    campaignId: after.campaignId,
    kapsoMessageId: after.kapsoMessageId,
    errorCode: after.errorCode,
  }
  try {
    const result = await retractCampaignSent({
      campaignId: after.campaignId,
      restaurantId: after.restaurantId,
      failureReason: deliveryFailureReason(after.errorCode, after.errorTitle),
    })
    if (!result) {
      args.log('warn', 'campaign.retract_no_match', context)
      return
    }
    args.log('info', 'campaign.send_retracted', { ...context, ...result })
  } catch (err) {
    args.log('error', 'campaign.retract_failed', {
      ...context,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}
