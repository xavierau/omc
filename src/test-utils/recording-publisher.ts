import type { IntegrationEvent } from '@/domain/entities/integration-event'
import type { IntegrationEventPublisher } from '@/domain/ports/integration-event-publisher'

/** Fake `IntegrationEventPublisher` -- records every published event in
 * order. Never throws. */
export class RecordingPublisher implements IntegrationEventPublisher {
  readonly events: IntegrationEvent[] = []

  async publish(event: IntegrationEvent): Promise<void> {
    this.events.push(event)
  }

  reset(): void {
    this.events.length = 0
  }
}
