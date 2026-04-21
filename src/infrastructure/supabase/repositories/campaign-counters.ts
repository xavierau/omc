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
