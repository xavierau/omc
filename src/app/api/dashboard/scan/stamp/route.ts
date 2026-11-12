// POST /api/dashboard/scan/stamp (plan §4.1) — Give-Stamp grant. Fail-closed tenant
// guard, resolve "scan any QR" → member, load the active campaign, apply the stamp
// (idempotent + 1/day cap in the RPC). Error outcomes (not_resolved / no_active_
// campaign) return HTTP 200 with an error body, mirroring the redeem route.
// /api/dashboard/scan/redeem is untouched.
import { NextRequest, NextResponse } from 'next/server'
import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'
import { resolveScanIdentity } from '@/application/resolve-scan-identity'
import { applyStampUseCase } from '@/application/apply-stamp-use-case'
import { findStampableCampaignForMember } from '@/infrastructure/supabase/repositories/stamp-campaign-repository'
import { getMemberContact } from '@/infrastructure/supabase/repositories/member-loyalty-repository'
import { getRestaurantPhoneNumberId } from '@/infrastructure/supabase/repositories/restaurant-repository'

export async function POST(request: NextRequest) {
  try {
    const { restaurantId, userId } = await getTenantContext()
    const body = await request.json().catch(() => ({}))
    const rawScan = typeof body.rawScan === 'string' ? body.rawScan : ''
    if (!rawScan.trim()) {
      return NextResponse.json({ error: 'invalid_input' }, { status: 400 })
    }
    return await grantStamp(rawScan, restaurantId, userId)
  } catch (error) {
    return handleError(error)
  }
}

async function grantStamp(
  rawScan: string,
  restaurantId: string,
  userId: string
): Promise<NextResponse> {
  const resolved = await resolveScanIdentity(rawScan, restaurantId)
  if ('error' in resolved) return NextResponse.json({ error: 'not_resolved' })

  // Resolve which campaign this grant lands on: the active campaign, OR — when none
  // is active — an ended-but-within-honor campaign the member already has an
  // in-progress card on (plan §9 grace path), so a card can still COMPLETE post-end.
  const campaign = await findStampableCampaignForMember(restaurantId, resolved.memberId)
  if (!campaign) return NextResponse.json({ error: 'no_active_campaign' })

  const result = await applyForMember(resolved.memberId, restaurantId, userId, campaign)
  return NextResponse.json(result)
}

async function applyForMember(
  memberId: string,
  restaurantId: string,
  userId: string,
  campaign: { id: string; maxStampsPerDay: number }
) {
  const contact = await getMemberContact(memberId, restaurantId)
  const phoneNumberId = await getRestaurantPhoneNumberId(restaurantId)
  return applyStampUseCase({
    restaurantId,
    memberId,
    campaignId: campaign.id,
    actorUserId: userId,
    maxPerDay: campaign.maxStampsPerDay,
    phone: contact?.phone ?? '',
    phoneNumberId,
    language: contact?.preferredLanguage ?? null,
  })
}

function handleError(error: unknown): NextResponse {
  if (error instanceof AuthError) {
    return NextResponse.json({ error: error.message }, { status: error.statusCode })
  }
  console.error('[scan/stamp] error:', error)
  return NextResponse.json({ error: 'server_error' }, { status: 500 })
}
