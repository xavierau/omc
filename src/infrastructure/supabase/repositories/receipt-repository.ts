import { createServerSupabaseClient } from '../client'

export async function createReceipt(params: {
  memberId: string
  restaurantId: string
  imageUrl: string
  status?: string
  flowforge_job_id?: string
}): Promise<string> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from('receipts')
    .insert({
      member_id: params.memberId,
      restaurant_id: params.restaurantId,
      image_url: params.imageUrl,
      status: params.status ?? 'processing',
      flowforge_job_id: params.flowforge_job_id,
    })
    .select('id')
    .single()

  if (error || !data) throw new Error(`createReceipt: ${error?.message}`)
  return data.id
}

export async function isReceiptNumberUsed(
  restaurantId: string,
  receiptNumber: string
): Promise<boolean> {
  const supabase = createServerSupabaseClient()
  const { data } = await supabase
    .from('receipts')
    .select('id')
    .eq('restaurant_id', restaurantId)
    .eq('receipt_number', receiptNumber)
    .neq('status', 'rejected')
    .limit(1)

  return (data?.length ?? 0) > 0
}

export async function updateReceipt(
  receiptId: string,
  updates: {
    total_amount?: number
    items_json?: unknown
    points_awarded?: number
    confidence?: number
    status?: string
    pending_amount?: number
    processed_at?: string
    flowforge_job_id?: string
    receipt_number?: string
    merchant_name?: string
    tamper_flags?: unknown
    layout_score?: number
    layout_flags?: unknown
  }
): Promise<void> {
  const supabase = createServerSupabaseClient()
  const { error } = await supabase
    .from('receipts')
    .update(updates)
    .eq('id', receiptId)

  if (error) throw new Error(`updateReceipt: ${error.message}`)
}

export async function findPendingReceipt(
  memberId: string
): Promise<Record<string, unknown> | null> {
  const supabase = createServerSupabaseClient()
  const { data } = await supabase
    .from('receipts')
    .select('*')
    .eq('member_id', memberId)
    .eq('status', 'pending_confirmation')
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  return data ?? null
}

export async function findReceiptByJobId(
  jobId: string
): Promise<Record<string, unknown> | null> {
  const supabase = createServerSupabaseClient()
  const { data } = await supabase
    .from('receipts')
    .select('*')
    .eq('flowforge_job_id', jobId)
    .single()

  return data ?? null
}
