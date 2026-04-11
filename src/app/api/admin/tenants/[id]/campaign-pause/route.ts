import { NextRequest, NextResponse } from 'next/server'
import { assertPlatformAdmin } from '@/infrastructure/supabase/guards/platform-admin-guard'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'
import { checkAdminRateLimit } from '@/infrastructure/rate-limit/admin-rate-limit'
import { pauseTenantCampaigns } from '@/application/pause-tenant-campaigns'
import { resumeTenantCampaigns } from '@/application/resume-tenant-campaigns'

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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
    if (!UUID_REGEX.test(id)) {
      return NextResponse.json({ error: 'Invalid tenant ID' }, { status: 400 })
    }
    const body = await request.json()

    if (typeof body.reason !== 'string' || !body.reason.trim()) {
      return NextResponse.json(
        { error: 'reason is required' },
        { status: 400 }
      )
    }

    await pauseTenantCampaigns(id, body.reason.trim())
    return NextResponse.json({ status: 'paused' })
  } catch (error) {
    return handleError(error, 'Campaign pause error')
  }
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  try {
    const { userId } = await assertPlatformAdmin()
    if (!checkAdminRateLimit(userId).success) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }
    const { id } = await params
    if (!UUID_REGEX.test(id)) {
      return NextResponse.json({ error: 'Invalid tenant ID' }, { status: 400 })
    }

    await resumeTenantCampaigns(id)
    return NextResponse.json({ status: 'resumed' })
  } catch (error) {
    return handleError(error, 'Campaign resume error')
  }
}

function handleError(error: unknown, label: string) {
  if (error instanceof AuthError) {
    return NextResponse.json({ error: error.message }, { status: error.statusCode })
  }
  console.error(`${label}:`, error)
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
}
