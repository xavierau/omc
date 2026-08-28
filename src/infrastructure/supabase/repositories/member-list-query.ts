// TAG-001: the members list query, extracted from member-repository.ts to keep
// both files within the 150-line budget. Adds an optional tagId filter and a
// tags embed (member_tags → tags) surfaced as a flat `tags` array on each row.

import { createServerSupabaseClient } from '../client'

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

// Tag filter as an embedded INNER JOIN, aliased so it does not collide with the
// display embed above. It replaces a pre-fetch of every member id for the tag,
// which was silently truncated at PostgREST `max-rows` and put ~36 bytes per id
// into the query string (review I-5(c)). One tag, and member_tags is keyed
// (member_id, tag_id), so at most one joined row per member — `count: exact`
// and `.range()` pagination stay accurate. The display embed stays un-filtered
// so the Tags column still shows ALL of each member's tags.
const TAG_FILTER_EMBED = 'tag_filter:member_tags!inner(tag_id)'

export async function getMembers(params: MemberListParams): Promise<MemberListResult> {
  const { restaurantId, page, pageSize, search, sortBy = 'last_visit_at', sortOrder = 'desc', tagId } = params

  // Two literal select calls rather than one built from a ternary: postgrest-js
  // parses the column list at compile time and cannot resolve a UNION of two
  // literals, though it parses either one on its own.
  const supabase = createServerSupabaseClient()
  const members = supabase.from('members')
  let query = tagId
    ? members
        .select(`${SELECT_COLUMNS}, ${TAG_FILTER_EMBED}`, { count: 'exact' })
        .eq('restaurant_id', restaurantId)
        .eq('tag_filter.tag_id', tagId)
    : members.select(SELECT_COLUMNS, { count: 'exact' }).eq('restaurant_id', restaurantId)
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

// `tag_filter` is the join used to filter; it is dropped here so it never
// leaks onto the wire row (the chips come from the `member_tags` embed).
function mapMemberRow(row: Record<string, unknown>): MemberRow {
  const { member_tags, ...rest } = row
  delete rest.tag_filter
  return { ...(rest as Omit<MemberRow, 'tags'>), tags: extractTags(member_tags) }
}

function extractTags(memberTags: unknown): MemberTagLite[] {
  if (!Array.isArray(memberTags)) return []
  return memberTags
    .map((mt) => (mt as { tags?: MemberTagLite | null }).tags)
    .filter((t): t is MemberTagLite => Boolean(t))
}
