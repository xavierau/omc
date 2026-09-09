// INT-001 WI-6 US-9: manual retry of one dead-lettered delivery.
// `retried_at IS NULL` is the ONE-retry-per-event guard (a second call
// returns `already_retried`); the job itself gets a fresh 5-attempt BullMQ
// budget via `jobId = deliveryId:r1`, distinct from the exhausted original.

import { findDeliveryById, saveDelivery } from '@/infrastructure/supabase/repositories/integration-delivery-repository'
import { addRetryDeliverJob } from '@/infrastructure/queue/integration-outbound-queue'

export type RetryDeliveryResult =
  | { ok: true }
  | { ok: false; error: 'not_found' | 'not_dead_lettered' | 'already_retried' }

export async function retryDelivery(deliveryId: string): Promise<RetryDeliveryResult> {
  const delivery = await findDeliveryById(deliveryId)
  if (!delivery) return { ok: false, error: 'not_found' }
  if (delivery.snapshot.status !== 'dead_lettered') return { ok: false, error: 'not_dead_lettered' }
  if (delivery.snapshot.retriedAt !== null) return { ok: false, error: 'already_retried' }

  const next = delivery.transitionTo('queued', { retriedAt: new Date().toISOString() })
  await saveDelivery(next)
  await addRetryDeliverJob(deliveryId)

  return { ok: true }
}
