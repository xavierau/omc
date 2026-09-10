import {
  adjustMemberPoints,
  findMemberByIdAndRestaurant,
  findMemberByPhone,
} from '@/infrastructure/supabase/repositories/member-repository'
import { emitEvent } from './emit-event'

export interface AdjustPointsParams {
  restaurantId: string
  memberId?: string
  phone?: string
  points: number
  reason?: string
  source?: string
  referenceId?: string
}

export interface AdjustPointsResult {
  memberId: string
  newBalance: number
  pointsChanged: number
}

export async function addPoints(
  params: AdjustPointsParams
): Promise<AdjustPointsResult> {
  if (params.points <= 0) throw new Error('Points must be positive')
  const memberId = await resolveMemberId(params)

  const newBalance = await adjustMemberPoints(memberId, params.points)

  await emitPointsEvent(params, memberId, params.points, newBalance)

  return { memberId, newBalance, pointsChanged: params.points }
}

export async function deductPoints(
  params: AdjustPointsParams
): Promise<AdjustPointsResult> {
  if (params.points <= 0) throw new Error('Points must be positive')
  const memberId = await resolveMemberId(params)

  const newBalance = await adjustMemberPoints(memberId, -params.points, {
    rejectNegative: true,
  })

  await emitPointsEvent(params, memberId, -params.points, newBalance)

  return { memberId, newBalance, pointsChanged: -params.points }
}

async function resolveMemberId(params: AdjustPointsParams): Promise<string> {
  if (params.memberId) {
    const member = await findMemberByIdAndRestaurant(params.restaurantId, params.memberId)
    if (!member) throw new Error('Member not found')
    return member.id
  }
  if (!params.phone) throw new Error('Either memberId or phone is required')

  const member = await findMemberByPhone(params.restaurantId, params.phone)
  if (!member) throw new Error('Member not found')
  return member.id
}

async function emitPointsEvent(
  params: AdjustPointsParams,
  memberId: string,
  amount: number,
  balanceAfter: number
): Promise<void> {
  const defaultReason = amount > 0 ? 'external_add' : 'external_deduct'
  await emitEvent({
    restaurantId: params.restaurantId,
    memberId,
    type: 'points',
    source: params.source,
    dataJson: {
      amount,
      reason: params.reason ?? defaultReason,
      source: params.source ?? 'api',
      reference_id: params.referenceId ?? null,
      balance_after: balanceAfter,
    },
  })
}
