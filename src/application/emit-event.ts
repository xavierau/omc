import { createEvent } from '@/infrastructure/supabase/repositories/event-repository'
import { resolveListenersForEvent } from '@/infrastructure/event-dispatch/tenant-listener-resolver'
import { addEventDispatchJob } from '@/infrastructure/queue/event-dispatch-queue'
import type { EventType } from '@/domain/entities/event'

export async function emitEvent(params: {
  restaurantId: string
  memberId: string | null
  type: EventType
  dataJson?: Record<string, unknown>
  source?: string
}): Promise<string> {
  const eventId = await createEvent(params)

  try {
    const listeners = await resolveListenersForEvent(
      params.restaurantId,
      params.type,
      params.source
    )
    if (listeners.length === 0) return eventId

    if (!process.env.REDIS_URL) {
      await dispatchSync(eventId, params, listeners)
      return eventId
    }

    const createdAt = new Date().toISOString()
    for (const { listenerKey } of listeners) {
      await addEventDispatchJob({
        eventId,
        restaurantId: params.restaurantId,
        memberId: params.memberId,
        eventType: params.type,
        dataJson: params.dataJson ?? {},
        createdAt,
        listenerKey,
        source: params.source ?? null,
      })
    }
  } catch (err) {
    console.warn('[EventDispatch] Dispatch failed, event persisted:', err)
    try {
      await createEvent({
        restaurantId: params.restaurantId,
        memberId: params.memberId,
        type: 'integration_error',
        dataJson: {
          originalEventId: eventId,
          originalEventType: params.type,
          error: err instanceof Error ? err.message : 'Unknown dispatch error',
          phase: 'dispatch_enqueue',
        },
      })
    } catch {
      // Last resort — don't let error logging break the caller
    }
  }

  return eventId
}

async function dispatchSync(
  eventId: string,
  params: { restaurantId: string; memberId: string | null; type: EventType; dataJson?: Record<string, unknown>; source?: string },
  listeners: { listenerKey: string }[]
): Promise<void> {
  const { resolveListener } = await import(
    '@/infrastructure/event-dispatch/listener-registry'
  )
  for (const { listenerKey } of listeners) {
    try {
      const listener = resolveListener(listenerKey)
      const createdAt = new Date().toISOString()
      await listener.handle({
        id: eventId,
        restaurantId: params.restaurantId,
        memberId: params.memberId,
        type: params.type,
        dataJson: params.dataJson ?? {},
        createdAt,
        source: params.source ?? null,
      })
    } catch (err) {
      console.warn(
        `[EventDispatch] Sync listener ${listenerKey} failed:`,
        err
      )
    }
  }
}
