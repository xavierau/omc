import type { EventType } from '@/domain/entities/event'
import type { PosIntegration } from '@/domain/entities/pos-integration'
import { findPosIntegrationsByRestaurant } from '@/infrastructure/supabase/repositories/pos-integration-repository'
import { getSupportedEventsForProvider } from './pos-event-listener'

const cache = new Map<string, { integrations: PosIntegration[]; expiresAt: number }>()
const CACHE_TTL_MS = 60_000

async function getCachedIntegrations(restaurantId: string) {
  const now = Date.now()
  const cached = cache.get(restaurantId)
  if (cached && now < cached.expiresAt) return cached.integrations

  const integrations = await findPosIntegrationsByRestaurant(restaurantId)
  cache.set(restaurantId, { integrations, expiresAt: now + CACHE_TTL_MS })
  return integrations
}

export function clearIntegrationCache(): void {
  cache.clear()
}

export async function resolveListenersForEvent(
  restaurantId: string,
  eventType: EventType,
  source?: string | null
): Promise<{ listenerKey: string }[]> {
  const integrations = await getCachedIntegrations(restaurantId)
  const listeners: { listenerKey: string }[] = []

  for (const integration of integrations) {
    if (integration.status !== 'active') continue
    try {
      const supported = getSupportedEventsForProvider(
        integration.provider
      )
      if (supported.includes(eventType)) {
        const listenerKey = `pos:${integration.id}`
        if (source && source.split(':')[0] === listenerKey.split(':')[0]) {
          continue
        }
        listeners.push({ listenerKey })
      }
    } catch (err) {
      console.warn(
        `[TenantListenerResolver] Skipping integration ${integration.id}:`,
        err
      )
    }
  }

  return listeners
}
