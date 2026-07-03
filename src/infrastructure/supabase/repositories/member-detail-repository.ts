import { createServerSupabaseClient } from '../client'
import type { MemberRow, MemberTagLite } from './member-repository'

export interface MemberDetail extends MemberRow {
  restaurant_id: string
  receipts: { id: string; total_amount: number; points_awarded: number; created_at: string; status: string }[]
  coupons: { id: string; code: string; type: string; status: string; redeemed_at: string | null }[]
  visitCount: number
}

export async function getMemberById(memberId: string): Promise<MemberDetail | null> {
  const supabase = createServerSupabaseClient()

  const [memberRes, receiptsRes, couponsRes, tagsRes] = await Promise.all([
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
    supabase
      .from('member_tags')
      .select('tags(id, name, color)')
      .eq('member_id', memberId),
  ])

  if (memberRes.error || !memberRes.data) return null

  return {
    ...(memberRes.data as MemberRow & { restaurant_id: string }),
    receipts: (receiptsRes.data ?? []) as MemberDetail['receipts'],
    coupons: (couponsRes.data ?? []) as MemberDetail['coupons'],
    visitCount: receiptsRes.data?.length ?? 0,
    tags: toMemberTags(tagsRes.data),
  }
}

function toMemberTags(data: unknown): MemberTagLite[] {
  if (!Array.isArray(data)) return []
  return data
    .map((r) => (r as { tags?: MemberTagLite | null }).tags)
    .filter((t): t is MemberTagLite => Boolean(t))
}
