import { createServerSupabaseClient } from '../client'

export interface MemberRow {
  id: string
  phone: string
  name: string | null
  points_balance: number
  status: string
  joined_at: string
  last_visit_at: string | null
  preferred_language: string | null
}

export type PreferredLanguageCode = 'en' | 'zh_hk'

export interface MemberListParams {
  restaurantId: string
  page: number
  pageSize: number
  search?: string
  sortBy?: 'name' | 'points_balance' | 'last_visit_at' | 'joined_at'
  sortOrder?: 'asc' | 'desc'
}

export interface MemberListResult {
  members: MemberRow[]
  total: number
}

export async function getMembers(params: MemberListParams): Promise<MemberListResult> {
  const supabase = createServerSupabaseClient()
  const { restaurantId, page, pageSize, search, sortBy = 'last_visit_at', sortOrder = 'desc' } = params

  let query = supabase
    .from('members')
    .select(
      'id, phone, name, points_balance, status, joined_at, last_visit_at, preferred_language',
      { count: 'exact' }
    )
    .eq('restaurant_id', restaurantId)

  if (search) {
    const sanitized = search.replace(/[%_,.()"'\\]/g, '')
    if (sanitized.length > 0) {
      query = query.or(`name.ilike.%${sanitized}%,phone.ilike.%${sanitized}%`)
    }
  }

  query = query.order(sortBy, { ascending: sortOrder === 'asc', nullsFirst: false })

  const from = (page - 1) * pageSize
  query = query.range(from, from + pageSize - 1)

  const { data, count, error } = await query

  if (error) throw new Error(`getMembers: ${error.message}`)

  return {
    members: (data ?? []) as MemberRow[],
    total: count ?? 0,
  }
}

export async function adjustMemberPoints(
  memberId: string,
  delta: number,
  options?: { rejectNegative?: boolean }
): Promise<number> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase.rpc('adjust_member_points', {
    p_member_id: memberId,
    p_delta: delta,
    p_reject_negative: options?.rejectNegative ?? false,
  })

  if (error) {
    if (error.message.includes('Insufficient points')) {
      throw new Error('Insufficient points balance')
    }
    if (error.message.includes('Member not found')) {
      throw new Error('Member not found')
    }
    throw new Error(`adjustMemberPoints: ${error.message}`)
  }

  return data as number
}

export async function updateMemberLastVisit(memberId: string): Promise<void> {
  const supabase = createServerSupabaseClient()
  const { error } = await supabase
    .from('members')
    .update({ last_visit_at: new Date().toISOString() })
    .eq('id', memberId)
  if (error) throw new Error(`updateMemberLastVisit: ${error.message}`)
}

export async function findMemberByIdAndRestaurant(
  restaurantId: string,
  memberId: string
): Promise<{ id: string; pointsBalance: number } | null> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from('members')
    .select('id, points_balance')
    .eq('id', memberId)
    .eq('restaurant_id', restaurantId)
    .single()
  if (error || !data) return null
  return { id: data.id, pointsBalance: data.points_balance }
}

export async function findMemberByPhone(
  restaurantId: string,
  phone: string
): Promise<{
  id: string
  pointsBalance: number
  preferredLanguage: string | null
} | null> {
  const supabase = createServerSupabaseClient()
  const { data } = await supabase
    .from('members')
    .select('id, points_balance, preferred_language')
    .eq('restaurant_id', restaurantId)
    .eq('phone', phone)
    .single()

  if (!data) return null
  return {
    id: data.id,
    pointsBalance: data.points_balance,
    preferredLanguage: (data.preferred_language as string | null) ?? null,
  }
}

/**
 * Tenant-scoped lookup of a single member's preferred-language code. Used by
 * the receipt-processing flow (which only has the memberId in context) to
 * localize the confirmation prompt and rejection reasons.
 *
 * Returns `null` when the member does not exist, the restaurant scope does
 * not match, or the member has not expressed a language preference.
 */
export async function getMemberPreferredLanguage(
  memberId: string,
  restaurantId: string
): Promise<string | null> {
  const supabase = createServerSupabaseClient()
  const { data } = await supabase
    .from('members')
    .select('preferred_language')
    .eq('id', memberId)
    .eq('restaurant_id', restaurantId)
    .single()
  if (!data) return null
  return (data.preferred_language as string | null) ?? null
}

export async function updateMemberPreferredLanguage(
  memberId: string,
  restaurantId: string,
  code: PreferredLanguageCode
): Promise<void> {
  const supabase = createServerSupabaseClient()
  const { error } = await supabase
    .from('members')
    .update({ preferred_language: code })
    .eq('id', memberId)
    .eq('restaurant_id', restaurantId)
  if (error) {
    throw new Error(`updateMemberPreferredLanguage: ${error.message}`)
  }
}

/**
 * Silent-detection variant. Only writes when preferred_language is still null
 * — guards against TOCTOU races where two concurrent inbounds from the same
 * new member both try to persist a detected script. The `restaurant_id`
 * clause is defense-in-depth against a mismatched `memberId` crossing
 * tenants.
 */
export async function setMemberPreferredLanguageIfUnset(
  memberId: string,
  restaurantId: string,
  code: PreferredLanguageCode
): Promise<void> {
  const supabase = createServerSupabaseClient()
  const { error } = await supabase
    .from('members')
    .update({ preferred_language: code })
    .eq('id', memberId)
    .eq('restaurant_id', restaurantId)
    .is('preferred_language', null)
  if (error) {
    throw new Error(`setMemberPreferredLanguageIfUnset: ${error.message}`)
  }
}

