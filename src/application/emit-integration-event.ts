// INT-001 WI-6: the real `IntegrationEventPublisher` adapter. Called
// directly (synchronously) by the seam (`create-or-get-member.ts`) for the
// `member.created` fast path; `member.updated` events are inserted by DB
// triggers and never reach this function.
//
// Two phases with very different failure tolerance:
//   1. Insert `integration_events` -- MUST succeed. This is the durable
//      record; the migration-071 AFTER INSERT trigger fans it out into
//      `integration_deliveries` in the SAME transaction, so by the time
//      this insert resolves those rows already exist. A failure here
//      propagates to the caller (the seam), same as any other write.
//   2. Fast-path enqueue of the rows the trigger just created -- best
//      effort ONLY. This function never throws past step 1: the 30s relay
//      (`sweep-integration-queues.ts`) re-selects `queued AND enqueued_at
//      IS NULL` unconditionally, so a Redis hiccup here just means "the
//      relay delivers it ~30s later" instead of "the member.created event
//      is lost" (`principle_backstop_only_repairs_what_it_selects`).

import type { IntegrationEvent } from '@/domain/entities/integration-event'
import type { IntegrationEventPublisher } from '@/domain/ports/integration-event-publisher'
import { insertIntegrationEvent } from '@/infrastructure/supabase/repositories/integration-event-repository'
import {
  findQueuedUnenqueuedDeliveriesForEvent,
  markEnqueued,
} from '@/infrastructure/supabase/repositories/integration-delivery-repository'
import { addDeliverJob } from '@/infrastructure/queue/integration-outbound-queue'

export async function emitIntegrationEvent(event: IntegrationEvent): Promise<void> {
  await insertIntegrationEvent({
    id: event.id,
    restaurantId: event.restaurantId,
    memberId: event.memberId,
    type: event.type,
    changed: event.changed,
    source: event.source,
    originIntegrationId: event.originIntegrationId,
    occurredAt: event.occurredAt,
  })

  let deliveries
  try {
    deliveries = await findQueuedUnenqueuedDeliveriesForEvent(event.id)
  } catch (err) {
    console.warn('[emitIntegrationEvent] fan-out lookup failed; the 30s relay will catch up', {
      eventId: event.id,
      error: err instanceof Error ? err.message : String(err),
    })
    return
  }

  await Promise.all(deliveries.map((delivery) => fastPathEnqueue(delivery.snapshot.id)))
}

async function fastPathEnqueue(deliveryId: string): Promise<void> {
  try {
    await addDeliverJob(deliveryId)
    await markEnqueued(deliveryId, new Date().toISOString())
  } catch (err) {
    console.warn('[emitIntegrationEvent] fast-path enqueue failed; the 30s relay will catch up', {
      deliveryId,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

let publisherInstance: IntegrationEventPublisher | null = null

/** Module-level factory, matching the repo's existing pattern (e.g.
 * `getEmailProvider()`) -- the seam's default `deps.publisher`. */
export function getIntegrationEventPublisher(): IntegrationEventPublisher {
  if (!publisherInstance) publisherInstance = { publish: emitIntegrationEvent }
  return publisherInstance
}

export function _resetIntegrationEventPublisher(): void {
  publisherInstance = null
}
