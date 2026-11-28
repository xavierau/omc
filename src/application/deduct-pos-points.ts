import { createPosTransaction } from '@/infrastructure/supabase/repositories/pos-transaction-repository'
import { adjustMemberPoints } from '@/infrastructure/supabase/repositories/member-repository'
import { emitEvent } from '@/application/emit-event'
import { POINTS_PER_DOLLAR } from '@/lib/constants'
import { findPosTransactionMember, notifyPosTransaction } from './helpers/process-pos-transaction'
import type { PosWebhookEvent } from '@/domain/ports/pos-webhook'
import type { PosIntegration } from '@/domain/entities/pos-integration'

interface DeductPosPointsResult {
  transactionId: string | null
  pointsDeducted: number
  memberId: string | null
}

export async function deductPosPoints(
  event: PosWebhookEvent,
  integration: PosIntegration
): Promise<DeductPosPointsResult> {
  const member = await findPosTransactionMember(event, integration)
  const pointsToDeduct = Math.floor(event.amount / POINTS_PER_DOLLAR)

  const txId = await createPosTransaction({
    posIntegrationId: integration.id,
    restaurantId: integration.restaurantId,
    memberId: member?.id ?? null,
    externalTransactionId: event.externalTransactionId,
    type: 'refund',
    amount: event.amount,
    currency: event.currency,
    customerPhone: event.customerPhone,
    pointsAwarded: member ? -pointsToDeduct : 0,
    rawPayload: event.rawPayload,
    processedAt: event.timestamp,
  })

  if (!txId) return { transactionId: null, pointsDeducted: 0, memberId: null }

  if (member && pointsToDeduct > 0) {
    const newBalance = await adjustMemberPoints(member.id, -pointsToDeduct)
    if (newBalance === 0 && pointsToDeduct > 0) {
      console.warn(`[DeductPosPoints] Balance clamped to 0 for member ${member.id}, attempted deduct: ${pointsToDeduct}`)
    }
    await logRefundEvent(integration.restaurantId, member.id, txId, event.amount, pointsToDeduct)
    const msg = `Refund of $${event.amount} processed. ${pointsToDeduct} points deducted. Balance: ${newBalance} points.`
    if (event.customerPhone) {
      await notifyPosTransaction(integration.restaurantId, event.customerPhone, msg)
    }
  }

  return {
    transactionId: txId,
    pointsDeducted: member ? pointsToDeduct : 0,
    memberId: member?.id ?? null,
  }
}

async function logRefundEvent(
  restaurantId: string, memberId: string, txId: string, amount: number, points: number
): Promise<void> {
  await emitEvent({
    restaurantId, memberId, type: 'pos_refund',
    dataJson: { transaction_id: txId, amount, points_deducted: points, source: 'pos' },
  })
}
