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
 * Covered by `idx_wa_messages_campaign_status`. `queuedSince` drops earlier
 * runs, when the campaign has a last-enqueued stamp to bound them by.
 */
export async function countFailedCampaignQrImages(args: {
  campaignId: string
  restaurantId: string
  queuedSince?: string | null
}): Promise<number> {
  const supabase = createServerSupabaseClient()
  const failed = supabase
    .from('whatsapp_messages')
    .select('id', { count: 'exact', head: true })
    .eq('campaign_id', args.campaignId)
    .eq('restaurant_id', args.restaurantId)
    .eq('message_type', 'image')
    .eq('status', 'failed')
  const { count, error } = await (args.queuedSince
    ? failed.gte('queued_at', args.queuedSince)
    : failed)
  if (error) throw new Error(`countFailedCampaignQrImages: ${error.message}`)
  return count ?? 0
}

export interface CampaignScope {
  campaignId: string
  restaurantId: string
}

/**
 * Body rows on record for a campaign (CAMP-014). Zero means the per-member ledger
 * has nothing to skip with, so /rerun cannot tell who already got the message.
 */
export async function countCampaignBodyRows(scope: CampaignScope): Promise<number> {
  const supabase = createServerSupabaseClient()
  const { count, error } = await supabase
    .from('whatsapp_messages')
    .select('id', { count: 'exact', head: true })
    .eq('campaign_id', scope.campaignId)
    .eq('restaurant_id', scope.restaurantId)
    .in('message_type', CAMPAIGN_BODY_MESSAGE_TYPES as unknown as string[])
  if (error) throw new Error(`countCampaignBodyRows: ${error.message}`)
  return count ?? 0
}

/**
 * Failed body rows with no Meta code (CAMP-014): error_code is null or not all
 * digits. Null means our side recorded the failure (kapso_send_error,
 * kapso_no_message_id, send_threw) with no decision from Meta; internal_orphan means
 * the sweep lost track of the row. Either way the customer may have received the
 * message. An allow-list of Meta's numeric codes, so any future internal code counts
 * too. The null test is explicit because a regex comparison against NULL matches nothing.
 */
export async function countFailedBodyRowsWithoutMetaCode(scope: CampaignScope): Promise<number> {
  const supabase = createServerSupabaseClient()
  const { count, error } = await supabase
    .from('whatsapp_messages')
    .select('id', { count: 'exact', head: true })
    .eq('campaign_id', scope.campaignId)
    .eq('restaurant_id', scope.restaurantId)
    .eq('status', 'failed')
    .in('message_type', CAMPAIGN_BODY_MESSAGE_TYPES as unknown as string[])
    .or('error_code.is.null,error_code.not.match.^[0-9]+$')
  if (error) throw new Error(`countFailedBodyRowsWithoutMetaCode: ${error.message}`)
  return count ?? 0
}

/**
 * Body rows still queued with no wamid (CAMP-014). A send ends with a wamid or a failed
 * row, so outside an in-flight call this means saving the outcome was lost and the
 * customer may have received the message. The sweep turns these into internal_orphan.
 */
export async function countQueuedBodyRowsWithoutWamid(scope: CampaignScope): Promise<number> {
  const supabase = createServerSupabaseClient()
  const { count, error } = await supabase
    .from('whatsapp_messages')
    .select('id', { count: 'exact', head: true })
    .eq('campaign_id', scope.campaignId)
    .eq('restaurant_id', scope.restaurantId)
    .eq('status', 'queued')
    .in('message_type', CAMPAIGN_BODY_MESSAGE_TYPES as unknown as string[])
    .is('kapso_message_id', null)
  if (error) throw new Error(`countQueuedBodyRowsWithoutWamid: ${error.message}`)
  return count ?? 0
}
