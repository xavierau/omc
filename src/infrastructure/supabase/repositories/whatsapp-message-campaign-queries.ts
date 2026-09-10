// Campaign-scoped reads against `whatsapp_messages` (#131). Kept out of
// `whatsapp-message-repository.ts` so the writer-of-record file stays under
// the size limit; this module only SELECTs.

import { createServerSupabaseClient } from '../client'

export interface CampaignFailure {
  errorCode: string | null
  errorTitle: string | null
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
    .select('error_code, error_title')
    .eq('campaign_id', campaignId)
    .eq('restaurant_id', restaurantId)
    .eq('status', 'failed')
    .in('message_type', CAMPAIGN_BODY_MESSAGE_TYPES as unknown as string[])
    .order('failed_at', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(`findLatestCampaignFailure: ${error.message}`)
  if (!data) return null
  const row = data as { error_code: string | null; error_title: string | null }
  return { errorCode: row.error_code ?? null, errorTitle: row.error_title ?? null }
}
