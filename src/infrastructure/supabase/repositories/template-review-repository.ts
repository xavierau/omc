// INVARIANT (WAQ-011): the SOLE writer to the `template_review_queue`
// table. `createServerSupabaseClient()` uses SUPABASE_SERVICE_ROLE_KEY
// which bypasses RLS — there are no INSERT/UPDATE policies on the table
// by design (see migration 044). Do NOT add a browser-side write path;
// route every mutation through the named functions below so callers stay
// observable.

import { createServerSupabaseClient } from '../client'
import { TemplateReview } from '@/domain/entities/template-review'
import type { TemplateReviewRepository } from '@/domain/repositories/template-review-repository'
import type { ReviewStatus } from '@/domain/value-objects/review-status'
import { ACTIVE_REVIEW_STATUSES } from '@/domain/value-objects/review-status'
import { toEntity, toRow, type TemplateReviewRow } from './template-review-mapper'

const TABLE = 'template_review_queue'

export async function insertTemplateReview(
  review: TemplateReview
): Promise<void> {
  const supabase = createServerSupabaseClient()
  const { error } = await supabase.from(TABLE).insert(toRow(review))
  if (!error) return
  if ((error as { code?: string }).code === '23505') {
    throw new Error(
      `insertTemplateReview: an active review already exists for (${review.snapshot.restaurantId}, ${review.snapshot.templateName})`
    )
  }
  throw new Error(`insertTemplateReview: ${error.message}`)
}

interface FindActiveByNameArgs {
  restaurantId: string
  templateName: string
}

export async function findActiveTemplateReviewByName(
  args: FindActiveByNameArgs
): Promise<TemplateReview | null> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .eq('restaurant_id', args.restaurantId)
    .eq('template_name', args.templateName)
    .in('status', ACTIVE_REVIEW_STATUSES as unknown as string[])
    .order('submitted_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(`findActiveTemplateReviewByName: ${error.message}`)
  if (!data) return null
  return toEntity(data as TemplateReviewRow)
}

export async function updateTemplateReview(
  review: TemplateReview
): Promise<void> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from(TABLE)
    .update(toRow(review))
    .eq('id', review.snapshot.id)
    .select('id')
  if (error) throw new Error(`updateTemplateReview: ${error.message}`)
  if (!data || data.length === 0) {
    throw new Error(
      `updateTemplateReview: no row matched id=${review.snapshot.id}`
    )
  }
}

interface ListForRestaurantArgs {
  restaurantId: string
  status?: ReviewStatus
}

export async function listTemplateReviewsForRestaurant(
  args: ListForRestaurantArgs
): Promise<TemplateReview[]> {
  const supabase = createServerSupabaseClient()
  let query = supabase
    .from(TABLE)
    .select('*')
    .eq('restaurant_id', args.restaurantId)
    .order('submitted_at', { ascending: false })
  if (args.status) query = query.eq('status', args.status)
  const { data, error } = await query
  if (error) {
    throw new Error(`listTemplateReviewsForRestaurant: ${error.message}`)
  }
  return ((data ?? []) as TemplateReviewRow[]).map(toEntity)
}

export async function listTemplateReviewsByStatus(args: {
  status: ReviewStatus
}): Promise<TemplateReview[]> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .eq('status', args.status)
    .order('submitted_at', { ascending: false })
  if (error) throw new Error(`listTemplateReviewsByStatus: ${error.message}`)
  return ((data ?? []) as TemplateReviewRow[]).map(toEntity)
}

export async function findTemplateReviewById(
  id: string
): Promise<TemplateReview | null> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error(`findTemplateReviewById: ${error.message}`)
  if (!data) return null
  return toEntity(data as TemplateReviewRow)
}

// Compile-time contract lock: this object MUST satisfy the domain
// repository interface. If a future edit drifts a function signature away
// from the port, TS surfaces it here rather than at the call sites — or,
// worse, at runtime.
export const templateReviewRepository: TemplateReviewRepository = {
  insert: insertTemplateReview,
  findActiveByName: findActiveTemplateReviewByName,
  update: updateTemplateReview,
  listForRestaurant: listTemplateReviewsForRestaurant,
  listByStatus: listTemplateReviewsByStatus,
  findById: findTemplateReviewById,
}
