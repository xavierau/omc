// POST /api/dashboard/scan/stamp/reverse (plan §9) — manual audited stamp removal.
// Fail-closed tenant guard captures the actor (userId). Body { memberId } (the
// result card / member detail page already holds it). Reversal targets the tenant's
// active campaign card; the RPC floors at 0 and writes a stamp_reversal event with
// the actor. Never a destructive count edit.
import { NextRequest, NextResponse } from 'next/server'
import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'
import { reverseStampUseCase } from '@/application/reverse-stamp-use-case'
import { findActiveStampCampaign } from '@/infrastructure/supabase/repositories/stamp-campaign-repository'

export async function POST(request: NextRequest) {
  try {
    const { restaurantId, userId } = await getTenantContext()
    const body = await request.json().catch(() => ({}))
    const memberId = typeof body.memberId === 'string' ? body.memberId.trim() : ''
    if (!memberId) {
      return NextResponse.json({ error: 'invalid_input' }, { status: 400 })
    }
    return await reverse(memberId, restaurantId, userId)
  } catch (error) {
    return handleError(error)
  }
}

async function reverse(
  memberId: string,
  restaurantId: string,
  userId: string
): Promise<NextResponse> {
  const campaign = await findActiveStampCampaign(restaurantId)
  if (!campaign) return NextResponse.json({ error: 'no_active_campaign' })

  const result = await reverseStampUseCase({
    restaurantId,
    memberId,
    campaignId: campaign.id,
    actorUserId: userId,
  })
  return NextResponse.json(result)
}

function handleError(error: unknown): NextResponse {
  if (error instanceof AuthError) {
    return NextResponse.json({ error: error.message }, { status: error.statusCode })
  }
  console.error('[scan/stamp/reverse] error:', error)
  return NextResponse.json({ error: 'server_error' }, { status: 500 })
}
