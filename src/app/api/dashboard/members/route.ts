import { NextRequest, NextResponse } from 'next/server'
import { getMembers, NO_TAG_FILTER } from '@/infrastructure/supabase/repositories/member-repository'
import { getMemberDetailForRestaurant } from '@/infrastructure/supabase/repositories/member-detail-repository'
import { getMemberQualityEvidenceSafe } from '@/infrastructure/supabase/repositories/member-quality-evidence'
import { getMemberQualitiesSafe } from '@/infrastructure/supabase/repositories/member-delivery-quality'
import { UNKNOWN_CONTACT_QUALITY } from '@/domain/value-objects/contact-quality'
import { MEMBERS_PAGE_SIZE } from '@/lib/constants'
import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'
import { isValidUUID } from '@/infrastructure/validation/validators'

// Upper bound for a caller-supplied ?pageSize=. Lets high-volume consumers
// (e.g. the campaign member picker, GH #103; the members table's 250 option, MEM-001) request a larger single page
// without opening the endpoint to unbounded requests.
const MAX_MEMBERS_PAGE_SIZE = 250

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
      // `return await` (not bare `return`) so a rejection from the handler
      // is caught below and answers the JSON 500 — a bare return lets it
      // bypass this try/catch entirely.
      return await handleMemberDetail(memberId, restaurantId)
    }

    return await handleMemberList(searchParams, restaurantId)
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
  const qualityEvidence = await getMemberQualityEvidenceSafe(memberId, restaurantId)
  return NextResponse.json({ ...member, qualityEvidence })
}

async function handleMemberList(searchParams: URLSearchParams, restaurantId: string) {
  const page = parseInt(searchParams.get('page') ?? '1', 10)
  const search = searchParams.get('search') ?? undefined
  const sortBy = (searchParams.get('sortBy') ?? 'last_visit_at') as 'name' | 'points_balance' | 'last_visit_at' | 'joined_at'
  const sortOrder = (searchParams.get('sortOrder') ?? 'desc') as 'asc' | 'desc'
  const tagId = searchParams.get('tagId') ?? undefined
  // A non-UUID tagId reaches PostgREST as `invalid input syntax for type uuid`,
  // which the catch-all reports as a 500 for bad client input (round 2, #8).
  if (tagId !== undefined && tagId !== NO_TAG_FILTER && !isValidUUID(tagId)) {
    return NextResponse.json({ error: 'tagId must be a UUID' }, { status: 400 })
  }
  const pageSize = resolvePageSize(searchParams.get('pageSize'))

  const result = await getMembers({
    restaurantId,
    page,
    pageSize,
    search,
    sortBy,
    sortOrder,
    tagId,
  })

  const qualities = await getMemberQualitiesSafe(restaurantId, result.members)
  const members = result.members.map((member) => {
    const { unreachable_at, ...wire } = member
    void unreachable_at // consumed by the quality rating; not part of the wire shape
    return { ...wire, quality: qualities.get(member.id) ?? { ...UNKNOWN_CONTACT_QUALITY } }
  })

  return NextResponse.json({
    members,
    total: result.total,
    page,
    pageSize,
    totalPages: Math.ceil(result.total / pageSize),
  })
}
