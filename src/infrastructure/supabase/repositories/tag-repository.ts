// TAG-001: SOLE writer to `tags` (alongside member-tag-repository). The
// service-role client bypasses RLS — the table has no INSERT/UPDATE/DELETE
// policies by design. Every query filters `restaurant_id` so tenant ownership
// is re-asserted in app code (lazy-flow authorization parity). The DB's
// lower(name) unique index surfaces a duplicate name as Postgres 23505 →
// TagNameConflictError (→ 409); a tenant-scoped update/delete that matches no
// row → TagNotFoundError (→ 404).

import { createServerSupabaseClient } from '../client'
import type { NewTag, Tag } from '@/domain/entities/tag'

const TABLE = 'tags'

/** Thrown when the DB rejects a tag write with a unique violation (23505). */
export class TagNameConflictError extends Error {
  readonly code = '23505'
  constructor(message: string) {
    super(message)
    this.name = 'TagNameConflictError'
  }
}

/** Thrown when a tenant-scoped update/delete matches no tag row. */
export class TagNotFoundError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TagNotFoundError'
  }
}

interface TagRow {
  id: string
  restaurant_id: string
  name: string
  color: string
  created_at: string
}

function toEntity(row: TagRow): Tag {
  return {
    id: row.id,
    restaurantId: row.restaurant_id,
    name: row.name,
    color: row.color,
    createdAt: row.created_at,
  }
}

async function insert(tag: NewTag): Promise<Tag> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from(TABLE)
    .insert({ restaurant_id: tag.restaurantId, name: tag.name, color: tag.color })
    .select('*')
    .single()
  if (error || !data) {
    if (error?.code === '23505') throw new TagNameConflictError(error.message)
    throw new Error(`insertTag: ${error?.message}`)
  }
  return toEntity(data as TagRow)
}

async function listByRestaurant(restaurantId: string): Promise<Tag[]> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .eq('restaurant_id', restaurantId)
    .order('name', { ascending: true })
  if (error) throw new Error(`listTagsByRestaurant: ${error.message}`)
  return ((data ?? []) as TagRow[]).map(toEntity)
}

async function rename(
  tagId: string,
  restaurantId: string,
  name: string
): Promise<Tag> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from(TABLE)
    .update({ name })
    .eq('id', tagId)
    .eq('restaurant_id', restaurantId)
    .select('*')
    .maybeSingle()
  if (error) {
    if (error.code === '23505') throw new TagNameConflictError(error.message)
    throw new Error(`renameTag: ${error.message}`)
  }
  if (!data) throw new TagNotFoundError(`Tag ${tagId} not found`)
  return toEntity(data as TagRow)
}

async function remove(tagId: string, restaurantId: string): Promise<void> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from(TABLE)
    .delete()
    .eq('id', tagId)
    .eq('restaurant_id', restaurantId)
    .select('id')
  if (error) throw new Error(`removeTag: ${error.message}`)
  if (!data || data.length === 0) {
    throw new TagNotFoundError(`Tag ${tagId} not found`)
  }
}

async function findIdsByRestaurant(
  restaurantId: string,
  tagIds: string[]
): Promise<string[]> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from(TABLE)
    .select('id')
    .eq('restaurant_id', restaurantId)
    .in('id', tagIds)
  if (error) throw new Error(`findIdsByRestaurant: ${error.message}`)
  return ((data ?? []) as Array<{ id: string }>).map((r) => r.id)
}

export const tagRepository = {
  insert,
  listByRestaurant,
  rename,
  remove,
  findIdsByRestaurant,
}
