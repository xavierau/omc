import { createServerSupabaseClient } from '../client'

/**
 * Hard-deletes a member and all tenant-scoped data referencing them
 * (pos_transactions, events, coupons, receipts). Dispatches to the
 * `delete_member_cascade` Postgres function so the five deletes happen
 * atomically inside a single transaction; if any step fails the whole
 * thing rolls back.
 *
 * The RPC also re-verifies `restaurant_id` ownership at the SQL layer as
 * defense-in-depth against a caller passing a cross-tenant member id.
 */
export async function deleteMemberAndCascade(
  memberId: string,
  restaurantId: string
): Promise<void> {
  const supabase = createServerSupabaseClient()
  const { error } = await supabase.rpc('delete_member_cascade', {
    p_member_id: memberId,
    p_restaurant_id: restaurantId,
  })

  if (error) {
    throw new Error(`deleteMemberAndCascade: ${error.message}`)
  }
}
