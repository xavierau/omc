import { updateReceipt } from '@/infrastructure/supabase/repositories/receipt-repository'
import { adjustMemberPoints } from '@/infrastructure/supabase/repositories/member-repository'
import { emitEvent } from '@/application/emit-event'
import { sendTextMessage } from '@/infrastructure/whatsapp/messaging'
import { POINTS_PER_DOLLAR } from '@/lib/constants'
import { Language } from '@/domain/value-objects/language'
import { pointsEarnedMessage } from './messages/award-points-messages'

interface AwardPointsParams {
  receiptId: string
  memberId: string
  restaurantId: string
  phoneNumberId: string
  amount: number
  parsed: { items?: unknown; confidence?: number; receiptNumber?: string | null; merchantName?: string | null }
  phone: string
  language?: Language
}

export async function awardPoints(params: AwardPointsParams): Promise<void> {
  const { receiptId, memberId, restaurantId, phoneNumberId, amount, parsed, phone } = params
  const language = params.language ?? Language.default()
  const points = Math.floor(amount / POINTS_PER_DOLLAR)

  await markReceiptConfirmed(receiptId, amount, parsed, points)
  const newBalance = await adjustMemberPoints(memberId, points)
  await logPointsEvents(restaurantId, memberId, receiptId, amount, points)
  await sendTextMessage(
    phoneNumberId,
    phone,
    pointsEarnedMessage(language, { pointsEarned: points, newBalance })
  )
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

async function logPointsEvents(
  restaurantId: string,
  memberId: string,
  receiptId: string,
  amount: number,
  points: number
): Promise<void> {
  await emitEvent({
    restaurantId,
    memberId,
    type: 'receipt',
    dataJson: { receipt_id: receiptId, amount },
  })
  await emitEvent({
    restaurantId,
    memberId,
    type: 'points',
    dataJson: { amount: points, reason: 'receipt', receipt_id: receiptId },
  })
}
