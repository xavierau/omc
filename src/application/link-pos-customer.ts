import {
  findUnlinkedTransactionsByPhone,
  claimUnlinkedTransaction,
} from '@/infrastructure/supabase/repositories/pos-transaction-repository'
import { adjustMemberPoints } from '@/infrastructure/supabase/repositories/member-repository'
import { emitEvent } from '@/application/emit-event'
import { POINTS_PER_DOLLAR } from '@/lib/constants'

interface LinkResult {
  linkedCount: number
  totalPoints: number
}

export async function linkPosCustomer(
  restaurantId: string,
  memberId: string,
  phone: string
): Promise<LinkResult> {
  const unlinked = await findUnlinkedTransactionsByPhone(restaurantId, phone)
  if (unlinked.length === 0) return { linkedCount: 0, totalPoints: 0 }

  let linkedCount = 0
  let totalPoints = 0

  for (const tx of unlinked) {
    const points = calculatePoints(tx.type, tx.amount)
    const claimed = await claimUnlinkedTransaction(tx.id, memberId, points)
    if (!claimed) {
      console.warn(`[LinkPosCustomer] Transaction ${tx.id} already claimed, skipping`)
      continue
    }
    try {
      await adjustMemberPoints(memberId, points)
    } catch (err) {
      console.warn(`[LinkPosCustomer] Failed to adjust points for tx ${tx.id}:`, err)
      continue
    }
    linkedCount++
    totalPoints += points

    await emitEvent({
      restaurantId,
      memberId,
      type: 'pos_customer_link',
      dataJson: { transaction_id: tx.id, amount: tx.amount, points, source: 'pos' },
    })
  }

  return { linkedCount, totalPoints }
}

function calculatePoints(type: string, amount: number): number {
  const base = Math.floor(amount / POINTS_PER_DOLLAR)
  return type === 'sale' ? base : -base
}
