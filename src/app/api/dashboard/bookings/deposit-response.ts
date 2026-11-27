/**
 * BOOK-014 W4 (spec AC-12, AC-13; threat R56, R58, R60): how the staff
 * deposit routes answer. Admin or staff of the session's tenant (staffContext,
 * R58); the restaurant comes only from the session and scopes every lookup,
 * so another restaurant's booking id is a 404 with no provider call. A move
 * the deposit's state does not allow (a second Refund, Keep after Refund,
 * Refund after Keep) is a 409 with the state it is in now.
 */
import { NextResponse } from 'next/server'
import type { DepositDecisionResult } from '@/application/payments/deposit-decisions'
import { depositViewOf } from '@/domain/entities/booking-deposit'
import { UUID } from '@/application/booking/staff-booking-shared'
import { NO_STORE, failure, staffContext } from './staff-access'

export type DepositMove = (ctx: { restaurantId: string; userId: string }, bookingId: string) => Promise<DepositDecisionResult>

export function depositDecisionResponse(result: DepositDecisionResult): NextResponse {
  if (result.ok) return NextResponse.json({ deposit: depositViewOf(result.deposit) }, { headers: NO_STORE })
  if (result.reason === 'not_found') return NextResponse.json({ error: 'not_found' }, { status: 404, headers: NO_STORE })
  return NextResponse.json({ error: 'conflict', status: result.status }, { status: 409, headers: NO_STORE })
}

export async function handleDepositMove(params: Promise<{ id: string }>, move: DepositMove, what: string): Promise<NextResponse> {
  try {
    const ctx = await staffContext()
    if (ctx instanceof NextResponse) return ctx
    const { id } = await params
    // A malformed id never reaches the database (22P02): a miss, like a foreign one.
    if (!UUID.test(id)) return NextResponse.json({ error: 'not_found' }, { status: 404, headers: NO_STORE })
    return depositDecisionResponse(await move({ restaurantId: ctx.restaurantId, userId: ctx.userId }, id))
  } catch (error) {
    return failure(error, what)
  }
}
