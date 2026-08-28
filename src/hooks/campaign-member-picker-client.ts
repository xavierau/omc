'use client'

// Network helper for the campaign member picker. Unlike the members-page
// `useMembers` hook (single page, fixed MEMBERS_PAGE_SIZE), this consumer
// requests a much larger page so a "Select all" click can honestly cover the
// full server-side search result in the common case (see GH #103).
export interface PickerMember {
  id: string
  name: string | null
  phone: string
}

export interface MemberPageParams {
  search: string
  page: number
  pageSize: number
}

export interface MemberPageResult {
  members: PickerMember[]
  total: number
  page: number
  totalPages: number
}

const ENDPOINT = '/api/dashboard/members'

// Clamped server-side to 200 (see route.ts MAX_MEMBERS_PAGE_SIZE) — large
// enough to capture the full member list for essentially every tenant today.
export const PICKER_PAGE_SIZE = 200

export function buildMemberSearchUrl({ search, page, pageSize }: MemberPageParams): string {
  const query = new URLSearchParams({ page: String(page), pageSize: String(pageSize) })
  const trimmed = search.trim()
  if (trimmed) query.set('search', trimmed)
  return `${ENDPOINT}?${query}`
}

export async function fetchMemberPage(params: MemberPageParams): Promise<MemberPageResult> {
  const res = await fetch(buildMemberSearchUrl(params))
  if (!res.ok) throw new Error('Failed to fetch members')
  const json = await res.json()
  return {
    members: json.members ?? [],
    total: json.total ?? 0,
    page: json.page ?? params.page,
    totalPages: json.totalPages ?? 1,
  }
}
