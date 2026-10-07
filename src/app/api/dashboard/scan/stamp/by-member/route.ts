// POST /api/dashboard/scan/stamp/by-member (plan §4.4) — the phone-lookup backstop
// that the GET /members/lookup affordance feeds into. When a QR cannot resolve, staff
// look the member up by phone (→ memberId) and stamp directly, BYPASSING the scan
// resolver. Same campaign resolution + applyStampUseCase as the scan route; only the
// identity source differs (a verified tenant-scoped memberId, not a raw scan). The
// scan/stamp and scan/redeem routes are untouched.
import { NextRequest, NextResponse } from 'next/server'
import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'
import { applyStampUseCase } from '@/application/apply-stamp-use-case'
import { findStampableCampaignForMember } from '@/infrastructure/supabase/repositories/stamp-campaign-repository'
import { getMemberContact } from '@/infrastructure/supabase/repositories/member-loyalty-repository'
import { getRestaurantPhoneNumberId } from '@/infrastructure/supabase/repositories/restaurant-repository'

export async function POST(request: NextRequest) {
  try {
    const { restaurantId, userId } = await getTenantContext()
    const body = await request.json().catch(() => ({}))
    const memberId = typeof body.memberId === 'string' ? body.memberId.trim() : ''
    if (!memberId) {
      return NextResponse.json({ error: 'invalid_input' }, { status: 400 })
    }
    return await grantStamp(memberId, restaurantId, userId)
  } catch (error) {
    return handleError(error)
  }
}

async function grantStamp(
  memberId: string,
  restaurantId: string,
  userId: string
): Promise<NextResponse> {
  const campaign = await findStampableCampaignForMember(restaurantId, memberId)
  if (!campaign) return NextResponse.json({ error: 'no_active_campaign' })

  const contact = await getMemberContact(memberId, restaurantId)
  const phoneNumberId = await getRestaurantPhoneNumberId(restaurantId)
  const result = await applyStampUseCase({
    restaurantId,
    memberId,
    campaignId: campaign.id,
    actorUserId: userId,
    maxPerDay: campaign.maxStampsPerDay,
    phone: contact?.phone ?? '',
    phoneNumberId,
    language: contact?.preferredLanguage ?? null,
  })
  return NextResponse.json(result)
}

function handleError(error: unknown): NextResponse {
  if (error instanceof AuthError) {
    return NextResponse.json({ error: error.message }, { status: error.statusCode })
  }
  console.error('[scan/stamp/by-member] error:', error)
  return NextResponse.json({ error: 'server_error' }, { status: 500 })
}
