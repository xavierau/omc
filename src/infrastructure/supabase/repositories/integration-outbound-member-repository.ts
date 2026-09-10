// INT-001 WI-6: the ONE read `build-outbound-payload.ts` needs of `members`
// -- kept as its own file rather than added to `member-repository.ts`
// (already at the 150-line file budget) or `member-create-repository.ts`
// (the sole INSERT file; this is a read). Attempt-time only (T-H7): the
// outbound job carries `{deliveryId}` alone, so every field here is
// re-read from Postgres at send time, never from the job payload.

import { createServerSupabaseClient } from '../client'

export interface OutboundMemberView {
  id: string
  restaurantId: string
  phone: string
  name: string | null
  status: 'active' | 'unsubscribed'
  preferredLanguage: string | null
  joinedAt: string
}

interface MemberRow {
  id: string
  restaurant_id: string
  phone: string
  name: string | null
  status: 'active' | 'unsubscribed'
  preferred_language: string | null
  joined_at: string
}

export async function findMemberForOutboundPayload(
  memberId: string
): Promise<OutboundMemberView | null> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from('members')
    .select('id, restaurant_id, phone, name, status, preferred_language, joined_at')
    .eq('id', memberId)
    .maybeSingle()
  if (error) throw new Error(`findMemberForOutboundPayload: ${error.message}`)
  if (!data) return null
  const row = data as MemberRow
  return {
    id: row.id,
    restaurantId: row.restaurant_id,
    phone: row.phone,
    name: row.name,
    status: row.status,
    preferredLanguage: row.preferred_language,
    joinedAt: row.joined_at,
  }
}
