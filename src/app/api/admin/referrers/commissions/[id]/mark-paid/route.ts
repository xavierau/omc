import { NextRequest, NextResponse } from 'next/server'
import { assertPlatformAdmin } from '@/infrastructure/supabase/guards/platform-admin-guard'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'
import { checkAdminRateLimit } from '@/infrastructure/rate-limit/admin-rate-limit'
import { logAdminAction, extractIp } from '@/infrastructure/supabase/audit-logger'
import { markCommissionPaidUseCase } from '@/application/mark-commission-paid'
import { isValidUUID } from '@/infrastructure/validation/validators'

interface RouteParams {
  params: Promise<{ id: string }>
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { userId } = await assertPlatformAdmin()
    if (!checkAdminRateLimit(userId).success) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }

    const { id } = await params
    if (!isValidUUID(id)) {
      return NextResponse.json({ error: 'Invalid commission ID' }, { status: 400 })
    }

    const result = await markCommissionPaidUseCase(id)
    if (!result.success) {
      return NextResponse.json({ error: result.message }, { status: 400 })
    }

    logAdminAction({
      userId,
      action: 'commission.mark_paid',
      resourceType: 'referrer_commission',
      resourceId: id,
      details: {},
      ipAddress: extractIp(request),
    })

    return NextResponse.json(result.commission)
  } catch (error) {
    return handleError(error)
  }
}

function handleError(error: unknown) {
  if (error instanceof AuthError) {
    return NextResponse.json({ error: error.message }, { status: error.statusCode })
  }
  console.error('Mark commission paid error:', error)
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
}
