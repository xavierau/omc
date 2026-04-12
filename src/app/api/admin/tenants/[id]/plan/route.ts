import { NextRequest, NextResponse } from 'next/server'
import { assertPlatformAdmin } from '@/infrastructure/supabase/guards/platform-admin-guard'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'
import { checkAdminRateLimit } from '@/infrastructure/rate-limit/admin-rate-limit'
import { isValidPlan, planCampaignQuota } from '@/domain/value-objects/tenant-plan'
import { changeTenantPlan } from '@/application/change-tenant-plan'
import { logAdminAction, extractIp } from '@/infrastructure/supabase/audit-logger'

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface RouteParams {
  params: Promise<{ id: string }>
}

export async function PATCH(
  request: NextRequest,
  { params }: RouteParams
) {
  try {
    const { userId } = await assertPlatformAdmin()
    if (!checkAdminRateLimit(userId).success) {
      return NextResponse.json(
        { error: 'Too many requests' },
        { status: 429 }
      )
    }
    const { id } = await params
    if (!UUID_REGEX.test(id)) {
      return NextResponse.json(
        { error: 'Invalid tenant ID' },
        { status: 400 }
      )
    }
    const body = await request.json()
    if (!body.plan || !isValidPlan(body.plan)) {
      return NextResponse.json(
        { error: 'Invalid plan. Must be starter, growth, or pro' },
        { status: 400 }
      )
    }

    await changeTenantPlan(id, body.plan)

    logAdminAction({
      userId,
      action: 'tenant.plan.change',
      resourceType: 'tenant',
      resourceId: id,
      details: { plan: body.plan },
      ipAddress: extractIp(request),
    })

    return NextResponse.json({ plan: body.plan, campaignQuota: planCampaignQuota(body.plan) })
  } catch (error) {
    return handleError(error)
  }
}

function handleError(error: unknown) {
  if (error instanceof AuthError) {
    return NextResponse.json(
      { error: error.message },
      { status: error.statusCode }
    )
  }
  console.error('Plan PATCH error:', error)
  return NextResponse.json(
    { error: 'Internal server error' },
    { status: 500 }
  )
}
