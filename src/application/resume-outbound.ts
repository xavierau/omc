// INT-001 WI-6 US-9: resume a paused integration's outbound deliveries.
// Sets `outbound_status: 'active'` and resets the failure streak to 0; the
// 30s relay does the actual re-enqueueing (this function only flips DB
// state) -- `paused -> queued` rows with `enqueued_at` cleared fall
// straight into the relay's own `queued AND enqueued_at IS NULL`
// selection on its very next tick.
//
// "up to inbound_queue_cap; beyond -> dead_lettered" (plan §Outbound
// Retry/resume) reuses `integration_settings.inbound_queue_cap` (an
// INBOUND setting) as the resume bound -- an odd cross-purpose reuse, but
// it's the plan's own literal wording, not something invented here.

import {
  findAllPausedDeliveryIdsForIntegration,
  findDeliveryById,
  saveDelivery,
} from '@/infrastructure/supabase/repositories/integration-delivery-repository'
import {
  findIntegrationSettingsByIdForRestaurant,
  updateOutboundBreakerState,
} from '@/infrastructure/supabase/repositories/integration-settings-repository'

/** Plan's own stated default for `inbound_queue_cap` when unset. */
const DEFAULT_QUEUE_CAP = 500

/** Grok finding #8: a resume click used to fire a single unbounded
 * `Promise.all` over every paused row (up to `inbound_queue_cap`, default
 * 500) -- up to 500 parallel PostgREST reads+writes at once on the shared
 * 4GB VM, contending with the inbound/outbound workers. Bounded to the
 * SAME sub-batch ceiling `execute-campaign-batch.ts` already established
 * for the identical class of risk (many independent per-row read+write
 * pairs fired from one admin action). */
export const RESUME_CONCURRENCY_LIMIT = 20

async function processInBatches<T>(items: T[], worker: (item: T) => Promise<void>): Promise<void> {
  for (let i = 0; i < items.length; i += RESUME_CONCURRENCY_LIMIT) {
    const batch = items.slice(i, i + RESUME_CONCURRENCY_LIMIT)
    await Promise.all(batch.map(worker))
  }
}

export type ResumeOutboundResult =
  | { ok: true; requeued: number; deadLettered: number }
  | { ok: false; error: 'integration_not_found' | 'url_invalid' }

export async function resumeOutbound(integrationId: string, restaurantId: string): Promise<ResumeOutboundResult> {
  // G-5 (WI-14, grok review, SEC-001/#111 pattern): scoped by BOTH ids in
  // the query itself -- this used to derive restaurantId from whatever row
  // `integrationId` happened to resolve to (correct for the breaker WRITE
  // in isolation, but no defense against a caller that skips the route's
  // own tenant-scoped pre-check from ever reading -- and then resuming --
  // another tenant's integration in the first place).
  const settings = await findIntegrationSettingsByIdForRestaurant(integrationId, restaurantId)
  if (!settings) return { ok: false, error: 'integration_not_found' }
  if (!settings.snapshot.outboundUrl) return { ok: false, error: 'url_invalid' }

  await updateOutboundBreakerState({
    integrationId,
    restaurantId: settings.snapshot.restaurantId,
    outboundFailureStreak: 0,
    outboundStatus: 'active',
    outboundPausedAt: null,
  })

  const cap = settings.snapshot.inboundQueueCap ?? DEFAULT_QUEUE_CAP
  const pausedIds = await findAllPausedDeliveryIdsForIntegration(integrationId)
  const toRequeue = pausedIds.slice(0, cap)
  const toDeadLetter = pausedIds.slice(cap)

  await processInBatches(toRequeue, requeueOne)
  await processInBatches(toDeadLetter, deadLetterOne)

  return { ok: true, requeued: toRequeue.length, deadLettered: toDeadLetter.length }
}

async function requeueOne(deliveryId: string): Promise<void> {
  const delivery = await findDeliveryById(deliveryId)
  if (!delivery || !delivery.canTransitionTo('queued')) return
  await saveDelivery(delivery.transitionTo('queued', { enqueuedAt: null }))
}

async function deadLetterOne(deliveryId: string): Promise<void> {
  const delivery = await findDeliveryById(deliveryId)
  if (!delivery || delivery.snapshot.status !== 'paused') return
  // `paused` only transitions directly to `queued` (WI-1's state machine);
  // `dead_lettered` is only reachable from `delivering`/`retrying`. These
  // are in-memory, chained transformations -- only the FINAL state is
  // persisted, so this is one write, not three.
  const dead = delivery
    .transitionTo('queued', {})
    .transitionTo('delivering', {})
    .transitionTo('dead_lettered', { deadLetteredAt: new Date().toISOString() })
  await saveDelivery(dead)
}
