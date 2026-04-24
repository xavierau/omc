import { NextRequest, NextResponse } from 'next/server'
import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'
import { getMemberById } from '@/infrastructure/supabase/repositories/member-detail-repository'
import { deleteMemberAndCascade } from '@/infrastructure/supabase/repositories/member-delete-cascade'

/**
 * Hard-deletes a member and all their related data (receipts, events,
 * coupons, POS transactions). Exists so staff can reset a demo account
 * and the original phone number is free to rejoin the same restaurant.
 *
 * Open to both `admin` and `staff` roles — the restriction for this
 * endpoint is intentionally looser than the member-list API because the
 * demo flow is run by staff, not just admins.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { restaurantId, role } = await getTenantContext()
    const { id } = await params

    // Explicit allowlist: guard against silent permission widening if a
    // future role (e.g. 'viewer') is added to user_tenants.role without
    // updating this endpoint.
    if (!['admin', 'staff'].includes(role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const member = await getMemberById(id)
    if (!member) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 })
    }
    if (member.restaurant_id !== restaurantId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    await deleteMemberAndCascade(id, restaurantId)
    return new NextResponse(null, { status: 204 })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.statusCode }
      )
    }
    console.error('Member DELETE error:', error)
    return NextResponse.json(
      { error: 'Failed to delete member' },
      { status: 500 }
    )
  }
}
