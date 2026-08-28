import { createServerSupabaseClient } from '../client'

/**
 * Bump the chargeable or non-chargeable sent counter on a campaign.
 * The boolean is passed explicitly by the caller (read off the campaign's
 * current `is_chargeable`) so billing is never implicit.
 *
 * Uses a server-side RPC (`increment_chargeable_sent` /
 * `increment_non_chargeable_sent`, defined in migration 027) so the update
 * is atomic. `execute-campaign.ts` dispatches batches of 20 in parallel via
 * Promise.allSettled — a read-modify-write client-side would lose
 * increments under contention.
 */
export async function incrementCampaignSent(
  id: string,
  isChargeable: boolean
): Promise<void> {
  const supabase = createServerSupabaseClient()
  const rpcName = isChargeable
    ? 'increment_chargeable_sent'
    : 'increment_non_chargeable_sent'

  const { error } = await supabase.rpc(rpcName, { p_campaign_id: id })

  if (error) {
    throw new Error(`incrementCampaignSent: ${error.message}`)
  }
}

/**
 * Atomically remap the welcome-campaign mapping for a restaurant:
 * - Set restaurants.welcome_campaign_id to the next campaign id
 * - Flip the previous campaign (if any) back to is_chargeable=true
 * - Flip the next campaign (if any) to is_chargeable=false
 *
 * Runs inside a single Postgres function so a mid-sequence failure cannot
 * leave the tables in an inconsistent state (see migration 027).
 */
export async function remapWelcomeCampaign(
  restaurantId: string,
  previousCampaignId: string | null,
  nextCampaignId: string | null
): Promise<void> {
  const supabase = createServerSupabaseClient()
  const { error } = await supabase.rpc('remap_welcome_campaign', {
    p_restaurant_id: restaurantId,
    p_previous_campaign_id: previousCampaignId,
    p_next_campaign_id: nextCampaignId,
  })
  if (error) {
    throw new Error(`remapWelcomeCampaign: ${error.message}`)
  }
}

export async function incrementCampaignRedeemed(id: string): Promise<void> {
  const supabase = createServerSupabaseClient()
  const { error } = await supabase.rpc('increment_campaign_redeemed', {
    campaign_id_param: id,
  })
  if (error) {
    throw new Error(`incrementCampaignRedeemed: ${error.message}`)
  }
}

export interface RetractCampaignSentResult {
  status: string
  chargeableSentCount: number
  nonChargeableSentCount: number
}

/**
 * Retract one counted send from a campaign's tally when a `failed` status
 * webhook arrives AFTER the batch already counted it as sent (#131: Meta
 * can reject a send asynchronously, after the synchronous batch tally ran).
 *
 * Single atomic RPC (migration 064) — decrements the bucket matching the
 * ROW's own `is_chargeable` (never read-then-decide in JS) and, if the
 * campaign was `completed` and both buckets have drained to zero, flips it
 * to `failed` with `failureReason` in the SAME statement. Scoped by
 * (campaignId, restaurantId) — authorize by scoped query, not
 * fetch-then-compare.
 *
 * Returns null when no row matched (wrong id/tenant) so the caller can log
 * a no-match warning instead of assuming the retraction applied.
 */
export async function retractCampaignSent(args: {
  campaignId: string
  restaurantId: string
  failureReason: string
}): Promise<RetractCampaignSentResult | null> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase.rpc('retract_campaign_sent', {
    p_campaign_id: args.campaignId,
    p_restaurant_id: args.restaurantId,
    p_failure_reason: args.failureReason,
  })
  if (error) throw new Error(`retractCampaignSent: ${error.message}`)

  const row = (Array.isArray(data) ? data[0] : data) as
    | { status: string; chargeable_sent_count: number; non_chargeable_sent_count: number }
    | null
    | undefined
  if (!row) return null
  return {
    status: row.status,
    chargeableSentCount: Number(row.chargeable_sent_count),
    nonChargeableSentCount: Number(row.non_chargeable_sent_count),
  }
}
