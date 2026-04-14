import { createServerSupabaseClient } from '../client'
import type { MemberRow } from './member-repository'

export interface MemberDetail extends MemberRow {
  receipts: { id: string; total_amount: number; points_awarded: number; created_at: string; status: string }[]
  coupons: { id: string; code: string; type: string; status: string; redeemed_at: string | null }[]
  visitCount: number
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
