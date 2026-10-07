// GET /api/dashboard/members/lookup?phone= (plan §4.4) — the always-works phone
// backstop for the Give-Stamp flow when a QR cannot resolve. Tenant-scoped
// findMemberByPhone → { memberId } the caller feeds to applyStampUseCase. A miss
// returns not_found (HTTP 200) so the UI can offer "Add as member" (§9).
import { NextRequest, NextResponse } from 'next/server'
import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'
import { findMemberByPhone } from '@/infrastructure/supabase/repositories/member-repository'

export async function GET(request: NextRequest) {
  try {
    const { restaurantId } = await getTenantContext()
    const phone = request.nextUrl.searchParams.get('phone')?.trim() ?? ''
    if (!phone) {
      return NextResponse.json({ error: 'invalid_input' }, { status: 400 })
    }
    const member = await findMemberByPhone(restaurantId, phone)
    if (!member) return NextResponse.json({ error: 'not_found' })
    return NextResponse.json({ memberId: member.id })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }
    console.error('[members/lookup] error:', error)
    return NextResponse.json({ error: 'server_error' }, { status: 500 })
  }
}
