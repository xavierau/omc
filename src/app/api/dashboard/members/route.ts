import { NextRequest, NextResponse } from 'next/server'
import { getMembers } from '@/infrastructure/supabase/repositories/member-repository'
import { getMemberDetailForRestaurant } from '@/infrastructure/supabase/repositories/member-detail-repository'
import { MEMBERS_PAGE_SIZE } from '@/lib/constants'
import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'

// Upper bound for a caller-supplied ?pageSize=. Lets high-volume consumers
// (e.g. the campaign member picker, GH #103) request a larger single page
// without opening the endpoint to unbounded requests.
const MAX_MEMBERS_PAGE_SIZE = 200

export function resolvePageSize(raw: string | null): number {
  const parsed = parseInt(raw ?? '', 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return MEMBERS_PAGE_SIZE
  return Math.min(parsed, MAX_MEMBERS_PAGE_SIZE)
}

export async function GET(request: NextRequest) {
  try {
    const { restaurantId } = await getTenantContext()
    const { searchParams } = request.nextUrl

    const memberId = searchParams.get('id')
    if (memberId) {
      return handleMemberDetail(memberId, restaurantId)
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

async function handleMemberDetail(memberId: string, restaurantId: string) {
  const member = await getMemberDetailForRestaurant(memberId, restaurantId)
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
  const pageSize = resolvePageSize(searchParams.get('pageSize'))

  const result = await getMembers({
    restaurantId,
    page,
    pageSize,
    search,
    sortBy,
    sortOrder,
  })

  return NextResponse.json({
    members: result.members,
    total: result.total,
    page,
    pageSize,
    totalPages: Math.ceil(result.total / pageSize),
  })
}
