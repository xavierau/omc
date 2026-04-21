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

export async function setCampaignChargeable(
  id: string,
  isChargeable: boolean
): Promise<void> {
  const supabase = createServerSupabaseClient()
  const { error } = await supabase
    .from('campaigns')
    .update({ is_chargeable: isChargeable })
    .eq('id', id)
  if (error) {
    throw new Error(`setCampaignChargeable: ${error.message}`)
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
