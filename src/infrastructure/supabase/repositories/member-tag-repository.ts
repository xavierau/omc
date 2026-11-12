// TAG-001: SOLE writer to `member_tags`. The service-role client bypasses RLS
// — the table has no INSERT/UPDATE/DELETE policies by design (migration 065).
// Because writes ignore RLS, tenant ownership is re-asserted in application
// code on every write (lazy-flow authorization parity). Mirrors the
// assertMembersBelongToTenant / CrossTenantMemberError shape in
// campaign-members-repository.ts.

import { createServerSupabaseClient } from '../client'
import type { Tag } from '@/domain/entities/tag'
import { CrossTenantMemberError } from './campaign-members-repository'
import { upsertMemberTagPairs, type MemberTagPair } from './member-tag-pairs'

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

/**
 * Idempotent bulk assignment of the memberIds×tagIds cross-product.
 *
 * The cross-product grows multiplicatively, so the bulk-tag route's own caps
 * (members × tags) put thousands of rows in one request long before either
 * cap looks large. `upsertMemberTagPairs` owns the chunking, so this builds
 * the pairs and delegates rather than issuing one unbounded upsert.
 */
export async function upsertMemberTags(
  restaurantId: string,
  memberIds: string[],
  tagIds: string[]
): Promise<void> {
  if (memberIds.length === 0 || tagIds.length === 0) return
  await upsertMemberTagPairs(restaurantId, buildPairs(memberIds, tagIds))
}

function buildPairs(memberIds: string[], tagIds: string[]): MemberTagPair[] {
  const pairs: MemberTagPair[] = []
  for (const memberId of memberIds) {
    for (const tagId of tagIds) pairs.push({ memberId, tagId })
  }
  return pairs
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

/**
 * Does this member currently carry ANY of `tagIds`? Tenant-scoped point query.
 * Deliberately NOT "list the audience, then check membership": an unpaged read
 * is silently truncated at PostgREST's `max-rows` (1000), so a targeted member
 * past that boundary would be refused. `limit(1)` also keeps the cost
 * independent of audience size on a per-tap path (review round 2, #1).
 */
export async function memberCarriesAnyTag(
  memberId: string,
  tagIds: string[],
  restaurantId: string
): Promise<boolean> {
  if (tagIds.length === 0) return false
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from('member_tags')
    .select('member_id')
    .eq('restaurant_id', restaurantId)
    .eq('member_id', memberId)
    .in('tag_id', tagIds)
    .limit(1)
  if (error) throw new Error(`memberCarriesAnyTag: ${error.message}`)
  return (data ?? []).length > 0
}
