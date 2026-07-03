import { NextRequest, NextResponse } from 'next/server'
import { getMembers } from '@/infrastructure/supabase/repositories/member-repository'
import { getMemberById } from '@/infrastructure/supabase/repositories/member-detail-repository'
import { MEMBERS_PAGE_SIZE } from '@/lib/constants'
import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'

export async function GET(request: NextRequest) {
  try {
    const { restaurantId } = await getTenantContext()
    const { searchParams } = request.nextUrl

    const memberId = searchParams.get('id')
    if (memberId) {
      return handleMemberDetail(memberId)
    }

    return handleMemberList(searchParams, restaurantId)
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }
    console.error('Members API error:', error)
    return NextResponse.json({ error: 'Failed to load members' }, { status: 500 })
  }
}

async function handleMemberDetail(memberId: string) {
  const member = await getMemberById(memberId)
  if (!member) {
    return NextResponse.json({ error: 'Member not found' }, { status: 404 })
  }
  return NextResponse.json(member)
}

async function handleMemberList(searchParams: URLSearchParams, restaurantId: string) {
  const page = parseInt(searchParams.get('page') ?? '1', 10)
  const search = searchParams.get('search') ?? undefined
  const sortBy = (searchParams.get('sortBy') ?? 'last_visit_at') as 'name' | 'points_balance' | 'last_visit_at' | 'joined_at'
  const sortOrder = (searchParams.get('sortOrder') ?? 'desc') as 'asc' | 'desc'
  const tagId = searchParams.get('tagId') ?? undefined

  const result = await getMembers({
    restaurantId,
    page,
    pageSize: MEMBERS_PAGE_SIZE,
    search,
    sortBy,
    sortOrder,
    tagId,
  })

  return NextResponse.json({
    members: result.members,
    total: result.total,
    page,
    pageSize: MEMBERS_PAGE_SIZE,
    totalPages: Math.ceil(result.total / MEMBERS_PAGE_SIZE),
  })
}
