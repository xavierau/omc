// Loyalty-token reads kept OFF the hot-path member-repository (findMemberByPhone
// selects only id/points_balance/preferred_language by design). These tenant-scoped
// lookups back the scan-resolver loyalty strategy and the 「我的會員碼」 keyword.
import { createServerSupabaseClient } from '../client'

/** Tenant-scoped: member id for a loyalty token, or null. */
export async function findMemberByLoyaltyToken(
  token: string,
  restaurantId: string
): Promise<string | null> {
  const supabase = createServerSupabaseClient()
  const { data } = await supabase
    .from('members')
    .select('id')
    .eq('loyalty_token', token)
    .eq('restaurant_id', restaurantId)
    .single()

  if (!data) return null
  return data.id as string
}

/**
 * Tenant-scoped phone + language for a member id — the contact the stamp
 * completion send needs (the resolver returns only memberId). Kept here off the
 * hot-path member-repository.
 */
export async function getMemberContact(
  memberId: string,
  restaurantId: string
): Promise<{ phone: string; preferredLanguage: string | null } | null> {
  const supabase = createServerSupabaseClient()
  const { data } = await supabase
    .from('members')
    .select('phone, preferred_language')
    .eq('id', memberId)
    .eq('restaurant_id', restaurantId)
    .single()

  if (!data) return null
  return {
    phone: data.phone as string,
    preferredLanguage: (data.preferred_language as string | null) ?? null,
  }
}

/** Tenant-scoped: a member's loyalty token by phone, or null. */
export async function findMemberLoyaltyTokenByPhone(
  phone: string,
  restaurantId: string
): Promise<{ memberId: string; loyaltyToken: string | null } | null> {
  const supabase = createServerSupabaseClient()
  const { data } = await supabase
    .from('members')
    .select('id, loyalty_token')
    .eq('phone', phone)
    .eq('restaurant_id', restaurantId)
    .single()

  if (!data) return null
  return {
    memberId: data.id as string,
    loyaltyToken: (data.loyalty_token as string | null) ?? null,
  }
}
