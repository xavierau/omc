// TAG-001: SOLE writer to `member_tags`. The service-role client bypasses RLS
// — the table has no INSERT/UPDATE/DELETE policies by design (migration 065).
// Because writes ignore RLS, tenant ownership is re-asserted in application
// code on every write (lazy-flow authorization parity). Mirrors the
// assertMembersBelongToTenant / CrossTenantMemberError shape in
// campaign-members-repository.ts.

import { createServerSupabaseClient } from '../client'
import type { Tag } from '@/domain/entities/tag'
import { CrossTenantMemberError } from './campaign-members-repository'

export class CrossTenantTagError extends Error {
  readonly statusCode = 403
  constructor(message: string) {
    super(message)
    this.name = 'CrossTenantTagError'
  }
}

/** Re-assert every tagId belongs to the caller's tenant before a write. */
export async function assertTagsBelongToTenant(
  tagIds: string[],
  restaurantId: string
): Promise<void> {
  if (tagIds.length === 0) return
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from('tags')
    .select('id')
    .eq('restaurant_id', restaurantId)
    .in('id', tagIds)
  if (error) throw new Error(`assertTagsBelongToTenant: ${error.message}`)
  const validIds = new Set((data ?? []).map((r) => r.id as string))
  if (validIds.size !== new Set(tagIds).size) {
    throw new CrossTenantTagError('Invalid tag IDs')
  }
}

/** Re-assert the member belongs to the caller's tenant before a write. */
export async function assertMemberBelongsToTenant(
  memberId: string,
  restaurantId: string
): Promise<void> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from('members')
    .select('id')
    .eq('restaurant_id', restaurantId)
    .eq('id', memberId)
    .maybeSingle()
  if (error) throw new Error(`assertMemberBelongsToTenant: ${error.message}`)
  if (!data) throw new CrossTenantMemberError('Invalid member ID')
}

/** Idempotent bulk assignment of the memberIds×tagIds cross-product. */
export async function upsertMemberTags(
  restaurantId: string,
  memberIds: string[],
  tagIds: string[]
): Promise<void> {
  if (memberIds.length === 0 || tagIds.length === 0) return
  const supabase = createServerSupabaseClient()
  const { error } = await supabase
    .from('member_tags')
    .upsert(buildRows(restaurantId, memberIds, tagIds), {
      onConflict: 'member_id,tag_id',
      ignoreDuplicates: true,
    })
  if (error) throw new Error(`upsertMemberTags: ${error.message}`)
}

function buildRows(restaurantId: string, memberIds: string[], tagIds: string[]) {
  const rows: { member_id: string; tag_id: string; restaurant_id: string }[] = []
  for (const memberId of memberIds) {
    for (const tagId of tagIds) {
      rows.push({ member_id: memberId, tag_id: tagId, restaurant_id: restaurantId })
    }
  }
  return rows
}

/** Remove one (member, tag) pair. Absent pair = no-op (0 rows affected). */
export async function deleteMemberTag(
  memberId: string,
  tagId: string,
  restaurantId: string
): Promise<void> {
  const supabase = createServerSupabaseClient()
  const { error } = await supabase
    .from('member_tags')
    .delete()
    .eq('member_id', memberId)
    .eq('tag_id', tagId)
    .eq('restaurant_id', restaurantId)
  if (error) throw new Error(`deleteMemberTag: ${error.message}`)
}

/** All tags carried by a member, tenant-scoped. */
export async function listTagsForMember(
  memberId: string,
  restaurantId: string
): Promise<Tag[]> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from('member_tags')
    .select('tags(id, name, color, restaurant_id, created_at)')
    .eq('member_id', memberId)
    .eq('restaurant_id', restaurantId)
  if (error) throw new Error(`listTagsForMember: ${error.message}`)
  return (data ?? [])
    .map((row) => toTag((row as { tags: unknown }).tags))
    .filter((t): t is Tag => t !== null)
}

function toTag(raw: unknown): Tag | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  return {
    id: r.id as string,
    restaurantId: r.restaurant_id as string,
    name: r.name as string,
    color: r.color as string,
    createdAt: r.created_at as string,
  }
}

/** Deduped member ids carrying any of the given tags, tenant-scoped. */
export async function listMemberIdsByTag(
  tagIds: string[],
  restaurantId: string
): Promise<string[]> {
  if (tagIds.length === 0) return []
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from('member_tags')
    .select('member_id')
    .eq('restaurant_id', restaurantId)
    .in('tag_id', tagIds)
  if (error) throw new Error(`listMemberIdsByTag: ${error.message}`)
  return Array.from(new Set((data ?? []).map((r) => r.member_id as string)))
}
