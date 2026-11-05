import type { DomainEvent, EventListenerPort } from '@/domain/ports/event-listener'
import type { EventType } from '@/domain/entities/event'
import { findPosIntegrationById } from '@/infrastructure/supabase/repositories/pos-integration-repository'

const PROVIDER_SUPPORTED_EVENTS: Record<string, readonly EventType[]> = {
  generic: [],
  ichef: [], // No adapter yet — enable when ichef webhook/API adapters are implemented
  square: [],
}

export function getSupportedEventsForProvider(
  provider: string
): readonly EventType[] {
  return PROVIDER_SUPPORTED_EVENTS[provider] ?? []
}

export function createPosEventListener(
  integrationId: string
): EventListenerPort {
  return {
    supportedEvents: [],
    async handle(event: DomainEvent): Promise<void> {
      const integration = await findPosIntegrationById(integrationId)
      if (!integration) {
        throw new Error(`POS integration not found: ${integrationId}`)
      }
      console.log(
        `[PosEventListener] Dispatching ${event.type} to ${integration.provider} (${integrationId})`
      )
      // Future: create provider via createPosProvider() and call API methods based on event.type
    },
  }
}
