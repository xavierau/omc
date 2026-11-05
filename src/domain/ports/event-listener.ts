import type { CrmEvent, EventType } from '../entities/event'

export type DomainEvent = CrmEvent

export interface EventListenerPort {
  readonly supportedEvents: readonly EventType[]
  handle(event: DomainEvent): Promise<void>
}
