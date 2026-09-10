import type { EventListenerPort } from '@/domain/ports/event-listener'
import { createPosEventListener } from './pos-event-listener'

type ListenerFactory = (id: string) => EventListenerPort

const factories = new Map<string, ListenerFactory>()

export function registerListenerFactory(
  prefix: string,
  factory: ListenerFactory
): void {
  factories.set(prefix, factory)
}

export function resolveListener(listenerKey: string): EventListenerPort {
  const colonIndex = listenerKey.indexOf(':')
  if (colonIndex === -1) {
    throw new Error(
      `Invalid listener key format: "${listenerKey}" (expected "prefix:id")`
    )
  }
  const prefix = listenerKey.substring(0, colonIndex)
  const id = listenerKey.substring(colonIndex + 1)
  const factory = factories.get(prefix)
  if (!factory) {
    throw new Error(`Unknown listener prefix: "${prefix}"`)
  }
  return factory(id)
}

// Register POS listener factory
registerListenerFactory('pos', (id) => createPosEventListener(id))
