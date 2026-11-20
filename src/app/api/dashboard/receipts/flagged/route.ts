import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/infrastructure/supabase/client'
import { updateReceipt } from '@/infrastructure/supabase/repositories/receipt-repository'
import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'

export async function GET() {
  try {
    const { restaurantId } = await getTenantContext()
    const receipts = await fetchFlaggedReceipts(restaurantId)
    return NextResponse.json({ receipts })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }
    console.error('Flagged receipts GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch flagged receipts' }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  try {
    await getTenantContext()
    const body = await request.json()
    const { receiptId, action } = body as { receiptId: string; action: string }

    if (!receiptId || !['approve', 'reject'].includes(action)) {
      return NextResponse.json(
        { error: 'receiptId and action (approve|reject) required' },
        { status: 400 }
      )
    }

    const status = action === 'approve' ? 'confirmed' : 'rejected'
    await updateReceipt(receiptId, { status })
    return NextResponse.json({ status: 'ok' })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }
    console.error('Flagged receipts PATCH error:', error)
    return NextResponse.json({ error: 'Failed to update receipt' }, { status: 500 })
  }
}

async function fetchFlaggedReceipts(restaurantId: string) {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from('receipts')
    .select('id, image_url, total_amount, layout_score, layout_flags, created_at, member_id, members(phone, name)')
    .eq('restaurant_id', restaurantId)
    .eq('status', 'flagged')
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) throw new Error(`fetchFlaggedReceipts: ${error.message}`)
  return data ?? []
}
