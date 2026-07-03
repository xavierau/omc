// TAG-001: the members list query, extracted from member-repository.ts to keep
// both files within the 150-line budget. Adds an optional tagId filter and a
// tags embed (member_tags → tags) surfaced as a flat `tags` array on each row.

import { createServerSupabaseClient } from '../client'
import { listMemberIdsByTag } from './member-tag-repository'

export interface MemberTagLite {
  id: string
  name: string
  color: string
}

export interface MemberRow {
  id: string
  phone: string
  name: string | null
  points_balance: number
  status: string
  joined_at: string
  last_visit_at: string | null
  preferred_language: string | null
  tags: MemberTagLite[]
}

export interface MemberListParams {
  restaurantId: string
  page: number
  pageSize: number
  search?: string
  sortBy?: 'name' | 'points_balance' | 'last_visit_at' | 'joined_at'
  sortOrder?: 'asc' | 'desc'
  tagId?: string
}

export interface MemberListResult {
  members: MemberRow[]
  total: number
}

const SELECT_COLUMNS =
  'id, phone, name, points_balance, status, joined_at, last_visit_at, preferred_language, member_tags(tags(id, name, color))'

export async function getMembers(params: MemberListParams): Promise<MemberListResult> {
  const { restaurantId, page, pageSize, search, sortBy = 'last_visit_at', sortOrder = 'desc', tagId } = params

  // Tag filter: pre-fetch the tag's member ids (tenant-scoped) then constrain
  // the list with .in('id', …). This keeps `count` exact and pagination simple
  // while leaving the display embed un-filtered so the Tags column shows ALL
  // of each member's tags (not just the filtered one).
  const memberIds = tagId ? await listMemberIdsByTag([tagId], restaurantId) : null
  if (memberIds && memberIds.length === 0) return { members: [], total: 0 }

  const supabase = createServerSupabaseClient()
  let query = supabase
    .from('members')
    .select(SELECT_COLUMNS, { count: 'exact' })
    .eq('restaurant_id', restaurantId)
  if (memberIds) query = query.in('id', memberIds)
  query = applySearch(query, search)
  query = query.order(sortBy, { ascending: sortOrder === 'asc', nullsFirst: false })
  const from = (page - 1) * pageSize
  query = query.range(from, from + pageSize - 1)

  const { data, count, error } = await query
  if (error) throw new Error(`getMembers: ${error.message}`)
  const rows = (data ?? []) as Record<string, unknown>[]
  return { members: rows.map(mapMemberRow), total: count ?? 0 }
}

function applySearch<Q extends { or(filter: string): Q }>(query: Q, search?: string): Q {
  if (!search) return query
  const sanitized = search.replace(/[%_,.()"'\\]/g, '')
  if (sanitized.length === 0) return query
  return query.or(`name.ilike.%${sanitized}%,phone.ilike.%${sanitized}%`)
}

function mapMemberRow(row: Record<string, unknown>): MemberRow {
  const { member_tags, ...rest } = row
  return { ...(rest as Omit<MemberRow, 'tags'>), tags: extractTags(member_tags) }
}

function extractTags(memberTags: unknown): MemberTagLite[] {
  if (!Array.isArray(memberTags)) return []
  return memberTags
    .map((mt) => (mt as { tags?: MemberTagLite | null }).tags)
    .filter((t): t is MemberTagLite => Boolean(t))
}
