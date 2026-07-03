import { NextRequest, NextResponse } from 'next/server'
import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { listMemberTags } from '@/application/list-member-tags'
import { assignTagsToMember } from '@/application/assign-tags-to-member'
import { translateMemberTagError } from './route-errors'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { restaurantId } = await getTenantContext()
    const { id } = await params
    const tags = await listMemberTags(restaurantId, id)
    return NextResponse.json({ tags })
  } catch (error) {
    return translateMemberTagError(error)
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { restaurantId } = await getTenantContext()
    const { id } = await params
    const body = (await request.json()) as { tagIds?: unknown }
    if (!isStringArray(body.tagIds)) {
      return NextResponse.json(
        { error: 'tagIds must be an array of strings' },
        { status: 400 }
      )
    }
    // Ownership of memberId + every tagId is re-asserted inside the use-case.
    await assignTagsToMember({ restaurantId, memberId: id, tagIds: body.tagIds })
    const tags = await listMemberTags(restaurantId, id)
    return NextResponse.json({ tags })
  } catch (error) {
    return translateMemberTagError(error)
  }
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string')
}
