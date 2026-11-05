// Campaign-scoped reads against `whatsapp_messages` (#131). Kept out of
// `whatsapp-message-repository.ts` so the writer-of-record file stays under
// the size limit; this module only SELECTs.

import { createServerSupabaseClient } from '../client'

export interface CampaignFailure {
  errorCode: string | null
  errorTitle: string | null
  errorDetails: string | null
}

// Body message types are the ones the batch counts as a send (template or
// inline text). The coupon-QR `image` is a free-form follow-up and is never
// counted, so its failures must not decide a campaign's fate.
export const CAMPAIGN_BODY_MESSAGE_TYPES = ['template', 'text'] as const

/**
 * Latest Meta-rejected body message for a campaign, used to word the
 * campaign's `failure_reason` when the finaliser finds every counted send
 * already retracted (execute-campaign.ts, Amendment A1). Scoped by
 * restaurant so a campaign id from another tenant reads as "no failure".
 */
export async function findLatestCampaignFailure(
  campaignId: string,
  restaurantId: string
): Promise<CampaignFailure | null> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from('whatsapp_messages')
    .select('error_code, error_title, error_details')
    .eq('campaign_id', campaignId)
    .eq('restaurant_id', restaurantId)
    .eq('status', 'failed')
    .in('message_type', CAMPAIGN_BODY_MESSAGE_TYPES as unknown as string[])
    .order('failed_at', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(`findLatestCampaignFailure: ${error.message}`)
  if (!data) return null
  const row = data as {
    error_code: string | null
    error_title: string | null
    error_details: string | null
  }
  return {
    errorCode: row.error_code ?? null,
    errorTitle: row.error_title ?? null,
    errorDetails: row.error_details ?? null,
  }
}

/**
 * Coupon-QR images that failed for a campaign (CAMP-014). `image` on a campaign
 * row is only ever the QR (execute-campaign-send.ts, claim-handler.ts). An exact
 * head count, never a row read: PostgREST max-rows silently caps row reads.
 * Covered by `idx_wa_messages_campaign_status`.
 */
export async function countFailedCampaignQrImages(args: {
  campaignId: string
  restaurantId: string
}): Promise<number> {
  const supabase = createServerSupabaseClient()
  const { count, error } = await supabase
    .from('whatsapp_messages')
    .select('id', { count: 'exact', head: true })
    .eq('campaign_id', args.campaignId)
    .eq('restaurant_id', args.restaurantId)
    .eq('message_type', 'image')
    .eq('status', 'failed')
  if (error) throw new Error(`countFailedCampaignQrImages: ${error.message}`)
  return count ?? 0
}
