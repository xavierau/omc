// Per-member "already sent" ledger for campaign re-execution (CAMP-002 minimum,
// shipped with #131). Reads only; the writer of record stays
// `whatsapp-message-repository.ts`.

import { createServerSupabaseClient } from '../client'
import { CAMPAIGN_BODY_MESSAGE_TYPES } from './whatsapp-message-campaign-queries'

/**
 * Members of `memberIds` that already have a COUNTED body send for this
 * campaign — any body row whose status is not `failed`. `queued` (an
 * orphaned two-phase row) counts as sent on purpose: delivery is unknown,
 * and a duplicate marketing blast is the worse error. One `IN` query per
 * chunk, covered by `idx_wa_messages_campaign_status`.
 */
export async function findMemberIdsWithCountedSend(args: {
  campaignId: string
  restaurantId: string
  memberIds: string[]
}): Promise<Set<string>> {
  if (args.memberIds.length === 0) return new Set()
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from('whatsapp_messages')
    .select('member_id')
    .eq('campaign_id', args.campaignId)
    .eq('restaurant_id', args.restaurantId)
    .in('member_id', args.memberIds)
    .in('message_type', CAMPAIGN_BODY_MESSAGE_TYPES as unknown as string[])
    .neq('status', 'failed')
  if (error) throw new Error(`findMemberIdsWithCountedSend: ${error.message}`)
  const rows = (data ?? []) as Array<{ member_id: string | null }>
  return new Set(rows.map((r) => r.member_id).filter((id): id is string => !!id))
}
