import { createServerSupabaseClient } from '../client'

export interface MemberRow {
  id: string
  phone: string
  name: string | null
  points_balance: number
  status: string
  joined_at: string
  last_visit_at: string | null
}

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
    .select('id, phone, name, points_balance, status, joined_at, last_visit_at', { count: 'exact' })
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

export interface MemberDetail extends MemberRow {
  receipts: { id: string; total_amount: number; points_awarded: number; created_at: string; status: string }[]
  coupons: { id: string; code: string; type: string; status: string; redeemed_at: string | null }[]
  visitCount: number
}

export async function deductMemberPoints(
  memberId: string,
  points: number
): Promise<number> {
  const supabase = createServerSupabaseClient()

  const { data: member } = await supabase
    .from('members')
    .select('points_balance')
    .eq('id', memberId)
    .single()

  if (!member) throw new Error('Member not found')

  const newBalance = member.points_balance - points
  if (newBalance < 0) throw new Error('Insufficient points balance')

  const { error } = await supabase
    .from('members')
    .update({ points_balance: newBalance })
    .eq('id', memberId)

  if (error) throw new Error(`deductMemberPoints: ${error.message}`)

  return newBalance
}

export async function getMemberById(memberId: string): Promise<MemberDetail | null> {
  const supabase = createServerSupabaseClient()

  const [memberRes, receiptsRes, couponsRes] = await Promise.all([
    supabase.from('members').select('*').eq('id', memberId).single(),
    supabase
      .from('receipts')
      .select('id, total_amount, points_awarded, created_at, status')
      .eq('member_id', memberId)
      .order('created_at', { ascending: false })
      .limit(20),
    supabase
      .from('coupons')
      .select('id, code, type, status, redeemed_at')
      .eq('member_id', memberId)
      .order('created_at', { ascending: false }),
  ])

  if (memberRes.error || !memberRes.data) return null

  return {
    ...(memberRes.data as MemberRow),
    receipts: (receiptsRes.data ?? []) as MemberDetail['receipts'],
    coupons: (couponsRes.data ?? []) as MemberDetail['coupons'],
    visitCount: receiptsRes.data?.length ?? 0,
  }
}
