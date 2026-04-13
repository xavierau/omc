import { updateReceipt } from '@/infrastructure/supabase/repositories/receipt-repository'
import { createEvent } from '@/infrastructure/supabase/repositories/event-repository'
import { sendTextMessage } from '@/infrastructure/whatsapp/messaging'
import { createServerSupabaseClient } from '@/infrastructure/supabase/client'
import { POINTS_PER_DOLLAR } from '@/lib/constants'

interface AwardPointsParams {
  receiptId: string
  memberId: string
  restaurantId: string
  phoneNumberId: string
  amount: number
  parsed: { items?: unknown; confidence?: number; receiptNumber?: string | null; merchantName?: string | null }
  phone: string
}

export async function awardPoints(params: AwardPointsParams): Promise<void> {
  const { receiptId, memberId, restaurantId, phoneNumberId, amount, parsed, phone } = params
  const points = Math.floor(amount / POINTS_PER_DOLLAR)

  await markReceiptConfirmed(receiptId, amount, parsed, points)
  const newBalance = await addMemberPoints(memberId, points)
  await logPointsEvents(restaurantId, memberId, receiptId, amount, points)
  await sendTextMessage(phoneNumberId, phone,
    `You earned ${points} points!\nYour new balance: ${newBalance} points. Keep it up!`)
}

async function markReceiptConfirmed(
  receiptId: string,
  amount: number,
  parsed: { items?: unknown; confidence?: number; receiptNumber?: string | null; merchantName?: string | null },
  points: number
): Promise<void> {
  await updateReceipt(receiptId, {
    status: 'confirmed',
    total_amount: amount,
    items_json: parsed.items,
    points_awarded: points,
    confidence: parsed.confidence,
    processed_at: new Date().toISOString(),
    receipt_number: parsed.receiptNumber ?? undefined,
    merchant_name: parsed.merchantName ?? undefined,
  })
}

async function addMemberPoints(
  memberId: string,
  points: number
): Promise<number> {
  const supabase = createServerSupabaseClient()
  const { data: member } = await supabase
    .from('members')
    .select('points_balance')
    .eq('id', memberId)
    .single()

  const newBalance = (member?.points_balance ?? 0) + points
  await supabase
    .from('members')
    .update({ points_balance: newBalance, last_visit_at: new Date().toISOString() })
    .eq('id', memberId)

  return newBalance
}

async function logPointsEvents(
  restaurantId: string,
  memberId: string,
  receiptId: string,
  amount: number,
  points: number
): Promise<void> {
  await createEvent({
    restaurantId,
    memberId,
    type: 'receipt',
    dataJson: { receipt_id: receiptId, amount },
  })
  await createEvent({
    restaurantId,
    memberId,
    type: 'points',
    dataJson: { amount: points, reason: 'receipt', receipt_id: receiptId },
  })
}
