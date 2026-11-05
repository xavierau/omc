import { NextRequest, NextResponse } from 'next/server'
import { assertPlatformAdmin } from '@/infrastructure/supabase/guards/platform-admin-guard'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'
import { deleteUserTenant } from '@/infrastructure/supabase/repositories/user-tenant-repository'
import { logAdminAction, extractIp } from '@/infrastructure/supabase/audit-logger'
import { checkAdminRateLimit } from '@/infrastructure/rate-limit/admin-rate-limit'

interface RouteParams {
  params: Promise<{ id: string; userId: string }>
}

export async function DELETE(
  request: NextRequest,
  { params }: RouteParams
) {
  try {
    const { userId: adminId } = await assertPlatformAdmin()
    if (!checkAdminRateLimit(adminId).success) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }
    const { id, userId } = await params
    await deleteUserTenant(userId, id)

    logAdminAction({
      userId: adminId,
      action: 'user.remove',
      resourceType: 'user',
      resourceId: userId,
      details: { tenantId: id },
      ipAddress: extractIp(request),
    })

    return new NextResponse(null, { status: 204 })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.statusCode }
      )
    }
    console.error('Delete tenant user error:', error)
    return NextResponse.json(
      { error: 'Failed to remove user' },
      { status: 500 }
    )
  }
}
