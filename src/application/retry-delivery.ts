// INT-001 WI-6 US-9: manual retry of one dead-lettered delivery.
// `retried_at IS NULL` is the ONE-retry-per-event guard (a second call
// returns `already_retried`); the job itself gets a fresh 5-attempt BullMQ
// budget via `jobId = deliveryId:r1`, distinct from the exhausted original.
//
// WI-14 G-5 (grok review, SEC-001/#111 pattern): the lookup is scoped by
// integrationId AND restaurantId IN THE QUERY (findDeliveryByIdForIntegration),
// not a fetch-then-compare in application code. This used to rely entirely
// on the ROUTE's own separate unscoped-fetch-then-compare check running
// first -- correct today only because that check happens to exist, and a
// future caller of this function that skips it would retry/mutate another
// tenant's delivery. Scoping the query itself removes that dependency.

import {
  findDeliveryByIdForIntegration,
  saveDelivery,
} from '@/infrastructure/supabase/repositories/integration-delivery-repository'
import { addRetryDeliverJob } from '@/infrastructure/queue/integration-outbound-queue'

export type RetryDeliveryResult =
  | { ok: true }
  | { ok: false; error: 'not_found' | 'not_dead_lettered' | 'already_retried' }

export async function retryDelivery(
  deliveryId: string,
  integrationId: string,
  restaurantId: string
): Promise<RetryDeliveryResult> {
  const delivery = await findDeliveryByIdForIntegration(deliveryId, integrationId, restaurantId)
  if (!delivery) return { ok: false, error: 'not_found' }
  if (delivery.snapshot.status !== 'dead_lettered') return { ok: false, error: 'not_dead_lettered' }
  if (delivery.snapshot.retriedAt !== null) return { ok: false, error: 'already_retried' }

  const next = delivery.transitionTo('queued', { retriedAt: new Date().toISOString() })
  await saveDelivery(next)
  await addRetryDeliverJob(deliveryId)

  return { ok: true }
}
