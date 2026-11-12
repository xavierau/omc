import { NextRequest, NextResponse } from 'next/server'
import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { removeTagFromMember } from '@/application/remove-tag-from-member'
import { translateMemberTagError } from '../route-errors'

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; tagId: string }> }
) {
  try {
    const { restaurantId } = await getTenantContext()
    const { id, tagId } = await params
    // Idempotent: removing a tag the member does not carry succeeds (no-op).
    // Ownership of memberId + tagId is re-asserted inside the use-case.
    await removeTagFromMember({ restaurantId, memberId: id, tagId })
    return NextResponse.json({ success: true })
  } catch (error) {
    return translateMemberTagError(error)
  }
}
