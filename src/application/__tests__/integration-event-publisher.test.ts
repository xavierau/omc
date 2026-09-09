import { RecordingPublisher } from '@/test-utils/recording-publisher'
import type { IntegrationEvent } from '@/domain/entities/integration-event'
import { runIntegrationEventPublisherContract } from './integration-event-publisher.contract'

runIntegrationEventPublisherContract('fake: RecordingPublisher', () => {
  const publisher = new RecordingPublisher()
  return {
    publisher,
    listPublished: async (restaurantId: string): Promise<IntegrationEvent[]> =>
      publisher.events.filter((e) => e.restaurantId === restaurantId),
  }
})

// WI-6 adds a second call here:
//   runIntegrationEventPublisherContract('real: emitIntegrationEvent', async () => { ... })
// against the scratch-DB lane, once `emit-integration-event.ts` exists.
