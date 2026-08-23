import { createServerSupabaseClient } from '../client'
import { Campaign } from '@/domain/entities/campaign'
import {
  mapRowToCampaign,
  buildCampaignUpdateRow,
  extractConstraintName,
  type CreateCampaignParams,
  type UpdateCampaignParams,
} from './campaign-mapper'

export type { CreateCampaignParams, UpdateCampaignParams }
export { mapRowToCampaign }

/** Thrown when Postgres rejects a campaigns insert with 23505. */
export class CampaignUniqueViolationError extends Error {
  readonly code = '23505'
  constructor(readonly constraint: string | null, message: string) {
    super(message)
    this.name = 'CampaignUniqueViolationError'
  }
}

export async function createCampaign(
  params: CreateCampaignParams
): Promise<Campaign> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from('campaigns')
    .insert({
      restaurant_id: params.restaurantId,
      name: params.name,
      type: params.type,
      template: params.legacyTemplate,
      template_en: params.templateEn ?? null,
      template_zh_hk: params.templateZhHk ?? null,
      image_url_en: params.imageUrlEn ?? null,
      image_url_zh_hk: params.imageUrlZhHk ?? null,
      coupon_config: params.couponConfig ?? null,
      schedule: params.schedule ?? null,
      scheduled_at: params.scheduledAt ?? null,
      whatsapp_template_id: params.whatsappTemplateId ?? null,
      target_audience: params.targetAudience ?? 'all',
      status: params.status ?? 'draft',
    })
    .select('*')
    .single()

  if (error || !data) {
    if (error?.code === '23505') {
      throw new CampaignUniqueViolationError(
        extractConstraintName(error),
        error.message
      )
    }
    throw new Error(`createCampaign: ${error?.message}`)
  }
  return mapRowToCampaign(data)
}

export async function getCampaignById(
  id: string
): Promise<Campaign | null> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from('campaigns')
    .select('*')
    .eq('id', id)
    .single()

  if (error || !data) return null
  return mapRowToCampaign(data)
}

export async function listCampaigns(
  restaurantId: string
): Promise<Campaign[]> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from('campaigns')
    .select('*')
    .eq('restaurant_id', restaurantId)
    .order('created_at', { ascending: false })

  if (error) throw new Error(`listCampaigns: ${error.message}`)
  return (data ?? []).map(mapRowToCampaign)
}

/**
 * Returns the most recent PAUSED welcome campaign for a restaurant, if any.
 *
 * Used by `seedDefaultWelcomeCampaign` to reuse a leftover seed row from a
 * previous failed remap attempt, instead of creating a fresh paused row on
 * every retry (which would accumulate orphans because the idempotency
 * guard in the seeder only checks `welcomeCampaignId`).
 */
export async function findExistingPausedWelcome(
  restaurantId: string
): Promise<{ id: string } | null> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from('campaigns')
    .select('id')
    .eq('restaurant_id', restaurantId)
    .eq('type', 'welcome')
    .eq('status', 'paused')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw new Error(`findExistingPausedWelcome: ${error.message}`)
  return data ? { id: data.id } : null
}

export async function updateCampaign(
  id: string,
  changes: UpdateCampaignParams
): Promise<Campaign> {
  const supabase = createServerSupabaseClient()
  const update = buildCampaignUpdateRow(changes)

  const { data, error } = await supabase
    .from('campaigns')
    .update(update)
    .eq('id', id)
    .select('*')
    .single()

  if (error || !data) {
    if (error?.code === '23505') {
      throw new CampaignUniqueViolationError(
        extractConstraintName(error),
        error.message
      )
    }
    throw new Error(`updateCampaign: ${error?.message}`)
  }
  return mapRowToCampaign(data)
}

// Counter mutations + welcome-campaign remap RPC live in campaign-counters.ts;
// campaign-members operations live in campaign-members-repository.ts.
export { incrementCampaignSent, incrementCampaignRedeemed, remapWelcomeCampaign } from './campaign-counters'

export async function transitionCampaignStatus(
  id: string,
  fromStatus: Campaign['status'],
  toStatus: Campaign['status']
): Promise<boolean> {
  const supabase = createServerSupabaseClient()
  const { data } = await supabase
    .from('campaigns')
    .update({ status: toStatus })
    .eq('id', id)
    .eq('status', fromStatus)
    .select('id')
  return (data?.length ?? 0) > 0
}

/** How long a campaign stays leased after the cron enqueues a job for it. */
export const ENQUEUE_THROTTLE_MS = 5 * 60_000

/**
 * Take the enqueue lease on a still-`active` campaign (issue #95).
 *
 * Compare-and-swap, not read-then-write: the cron runs every minute and a
 * slow tick can overlap the next one. Returns false when another tick already
 * holds the lease, so the caller skips instead of enqueueing a duplicate.
 *
 * The lease expires on its own, which is the point — a campaign that fails
 * before `executeCampaign`'s active->sending claim stays `active` and would
 * otherwise be re-enqueued on every tick forever.
 *
 * Throws rather than returning false on a query error, unlike the sibling
 * `transitionCampaignStatus` above: a swallowed error here is indistinguishable
 * from "lease held" and would silently stop every scheduled send — which is
 * issue #95 all over again. Migration 056 documents the same swallow costing
 * exactly that. Let it reach the cron route, which 500s so the Forge job
 * turns red.
 */
export async function claimCampaignForEnqueue(
  id: string,
  throttleMs: number = ENQUEUE_THROTTLE_MS
): Promise<boolean> {
  const supabase = createServerSupabaseClient()
  const now = Date.now()
  const cutoff = new Date(now - throttleMs).toISOString()
  const { data, error } = await supabase
    .from('campaigns')
    .update({ last_enqueued_at: new Date(now).toISOString() })
    .eq('id', id)
    .eq('status', 'active')
    .or(`last_enqueued_at.is.null,last_enqueued_at.lt.${cutoff}`)
    .select('id')

  if (error) throw new Error(`claimCampaignForEnqueue: ${error.message}`)
  return (data?.length ?? 0) > 0
}

/**
 * Terminal transition for a campaign whose send has exhausted every queue
 * retry attempt (issue #102 Part B). Compare-and-swap on `status='active'`,
 * same reasoning as `claimCampaignForEnqueue`: only an active campaign can
 * still be sitting in `getDueCampaigns()`, and CAS avoids clobbering a row
 * a concurrent path already moved (e.g. a manual pause).
 */
export async function markCampaignFailed(
  id: string,
  failureReason: string
): Promise<boolean> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from('campaigns')
    .update({ status: 'failed', failure_reason: failureReason })
    .eq('id', id)
    .eq('status', 'active')
    .select('id')

  if (error) throw new Error(`markCampaignFailed: ${error.message}`)
  return (data?.length ?? 0) > 0
}

export async function getDueCampaigns(): Promise<Campaign[]> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from('campaigns')
    .select('*')
    .eq('status', 'active')
    .not('scheduled_at', 'is', null)
    .lte('scheduled_at', new Date().toISOString())

  if (error) throw new Error(`getDueCampaigns: ${error.message}`)
  return (data ?? []).map(mapRowToCampaign)
}

export { setCampaignMembers, getCampaignMemberIds, CrossTenantMemberError } from './campaign-members-repository'
