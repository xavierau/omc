import { createPosTransaction } from '@/infrastructure/supabase/repositories/pos-transaction-repository'
import { adjustMemberPoints, updateMemberLastVisit } from '@/infrastructure/supabase/repositories/member-repository'
import { emitEvent } from '@/application/emit-event'
import { POINTS_PER_DOLLAR } from '@/lib/constants'
import { findPosTransactionMember, notifyPosTransaction } from './helpers/process-pos-transaction'
import type { PosWebhookEvent } from '@/domain/ports/pos-webhook'
import type { PosIntegration } from '@/domain/entities/pos-integration'

interface AwardPosPointsResult {
  transactionId: string | null
  pointsAwarded: number
  memberId: string | null
}

export async function awardPosPoints(
  event: PosWebhookEvent,
  integration: PosIntegration
): Promise<AwardPosPointsResult> {
  const member = await findPosTransactionMember(event, integration)
  const points = Math.floor(event.amount / POINTS_PER_DOLLAR)

  const txId = await createPosTransaction({
    posIntegrationId: integration.id,
    restaurantId: integration.restaurantId,
    memberId: member?.id ?? null,
    externalTransactionId: event.externalTransactionId,
    type: 'sale',
    amount: event.amount,
    currency: event.currency,
    customerPhone: event.customerPhone,
    pointsAwarded: member ? points : 0,
    rawPayload: event.rawPayload,
    processedAt: event.timestamp,
  })

  if (!txId) return { transactionId: null, pointsAwarded: 0, memberId: null }

  if (member && points > 0) {
    const newBalance = await addMemberPointsAndUpdateVisit(member.id, points)
    await logPosEvents(integration.restaurantId, member.id, txId, event.amount, points)
    const msg = `You earned ${points} points from your purchase of $${event.amount}! Balance: ${newBalance} points.`
    if (event.customerPhone) {
      await notifyPosTransaction(integration.restaurantId, event.customerPhone, msg)
    }
  }

  return {
    transactionId: txId,
    pointsAwarded: member ? points : 0,
    memberId: member?.id ?? null,
  }
}

async function addMemberPointsAndUpdateVisit(memberId: string, points: number): Promise<number> {
  const newBalance = await adjustMemberPoints(memberId, points)
  await updateMemberLastVisit(memberId)
  return newBalance
}

async function logPosEvents(
  restaurantId: string, memberId: string, txId: string, amount: number, points: number
): Promise<void> {
  await emitEvent({
    restaurantId, memberId, type: 'pos_transaction',
    dataJson: { transaction_id: txId, amount, source: 'pos' },
  })
  await emitEvent({
    restaurantId, memberId, type: 'points',
    dataJson: { amount: points, reason: 'pos_sale', transaction_id: txId, source: 'pos' },
  })
}
