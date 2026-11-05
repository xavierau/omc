import { NextRequest, NextResponse } from 'next/server'
import { assertPlatformAdmin } from '@/infrastructure/supabase/guards/platform-admin-guard'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'
import { checkAdminRateLimit } from '@/infrastructure/rate-limit/admin-rate-limit'
import { listByReferrer } from '@/infrastructure/supabase/repositories/referrer-commission-repository'

interface RouteParams {
  params: Promise<{ id: string }>
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { userId } = await assertPlatformAdmin()
    if (!checkAdminRateLimit(userId).success) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }
    const { id } = await params
    const month = request.nextUrl.searchParams.get('month') ?? undefined
    const commissions = await listByReferrer(id, month)
    return NextResponse.json(commissions)
  } catch (error) {
    return handleError(error, 'Referrer commissions error')
  }
}

function handleError(error: unknown, label: string) {
  if (error instanceof AuthError) {
    return NextResponse.json({ error: error.message }, { status: error.statusCode })
  }
  console.error(`${label}:`, error)
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
}
