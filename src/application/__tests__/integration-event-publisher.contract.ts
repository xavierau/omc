// Shared contract suite for the `IntegrationEventPublisher` port (see
// plan §"Ports with fake + real adapters"). Runs against the fake
// (`RecordingPublisher`, WI-1) always; WI-6 adds a second invocation
// against the real `emitIntegrationEvent` adapter (scratch-DB lane).
//
// This file intentionally does NOT end in `.test.ts` -- it is a reusable
// generator, not a runnable spec on its own. See
// `integration-event-publisher.test.ts` for the invocation.

import { describe, expect, it } from 'vitest'
import type { IntegrationEvent } from '@/domain/entities/integration-event'
import type { IntegrationEventPublisher } from '@/domain/ports/integration-event-publisher'

export interface IntegrationEventPublisherAdapter {
  publisher: IntegrationEventPublisher
  /** Reads back everything published for a restaurant, in publish order. */
  listPublished(restaurantId: string): Promise<IntegrationEvent[]>
}

function buildEvent(overrides: Partial<IntegrationEvent> = {}): IntegrationEvent {
  return {
    id: `evt_contract_${Math.random().toString(36).slice(2)}`,
    restaurantId: 'r-contract',
    memberId: 'm-1',
    type: 'member.created',
    changed: [],
    originIntegrationId: null,
    occurredAt: new Date().toISOString(),
    // WI-6: `IntegrationEvent.source` became a required field (was absent
    // under WI-1) -- see integration-event.ts's doc comment. `null` here
    // keeps this generator's default event agnostic to provenance; a real
    // caller passes its own `source`.
    source: null,
    ...overrides,
  }
}

export function runIntegrationEventPublisherContract(
  label: string,
  createAdapter: () =>
    | IntegrationEventPublisherAdapter
    | Promise<IntegrationEventPublisherAdapter>
): void {
  describe(`IntegrationEventPublisher contract (${label})`, () => {
    it('publish() resolves without throwing for a well-formed event', async () => {
      const { publisher } = await createAdapter()
      await expect(publisher.publish(buildEvent())).resolves.toBeUndefined()
    })

    it('preserves publish order across multiple events for the same restaurant', async () => {
      const adapter = await createAdapter()
      const restaurantId = `r-contract-order-${Math.random().toString(36).slice(2)}`
      const events = [1, 2, 3].map((n) =>
        buildEvent({ id: `evt_contract_order_${n}`, restaurantId, memberId: `m-${n}` })
      )
      for (const event of events) await adapter.publisher.publish(event)
      const published = await adapter.listPublished(restaurantId)
      expect(published.map((e) => e.id)).toEqual(events.map((e) => e.id))
    })

    it('a publish for one restaurant is never visible under another restaurant', async () => {
      const adapter = await createAdapter()
      const restaurantA = `r-contract-a-${Math.random().toString(36).slice(2)}`
      const restaurantB = `r-contract-b-${Math.random().toString(36).slice(2)}`
      await adapter.publisher.publish(buildEvent({ restaurantId: restaurantA }))
      const publishedForB = await adapter.listPublished(restaurantB)
      expect(publishedForB).toEqual([])
    })
  })
}
