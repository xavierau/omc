'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useTenant } from '@/hooks/use-tenant'
import { REALTIME_POLL_INTERVAL_MS } from '@/lib/constants'

export interface RealtimeEvent {
  id: string
  type: string
  memberName: string | null
  dataJson: Record<string, unknown>
  createdAt: string
}

type ConnectionStatus = 'connected' | 'connecting' | 'disconnected'

export function useRealtimeEvents() {
  const { restaurantId } = useTenant()
  const [events, setEvents] = useState<RealtimeEvent[]>([])
  const [status, setStatus] = useState<ConnectionStatus>('connecting')
  const pollRef = useRef<NodeJS.Timeout | null>(null)

  const addEvent = useCallback((event: RealtimeEvent) => {
    setEvents((prev) => [event, ...prev].slice(0, 100))
  }, [])

  const pollEvents = useCallback(async () => {
    if (!restaurantId) return
    try {
      const res = await fetch('/api/dashboard/events?limit=10')
      if (!res.ok) return
      const json = await res.json()
      setEvents(
        json.events.map((e: Record<string, unknown>) => ({
          id: e.id,
          type: e.type,
          memberName: e.member_name,
          dataJson: e.data_json,
          createdAt: e.created_at,
        }))
      )
    } catch {
      // silently fail polling
    }
  }, [restaurantId])

  useEffect(() => {
    if (!restaurantId) {
      setEvents([])
      setStatus('disconnected')
      return
    }

    // Reset events on tenant switch
    setEvents([])
    setStatus('connecting')

    let channel: ReturnType<typeof import('@/lib/supabase-broadcast').subscribeToDashboardEvents> | null = null

    async function setupRealtime() {
      try {
        const { subscribeToDashboardEvents } = await import(
          '@/lib/supabase-broadcast'
        )

        channel = subscribeToDashboardEvents(
          (event) => addEvent(event),
          (realtimeStatus) => {
            if (realtimeStatus === 'SUBSCRIBED') {
              setStatus('connected')
              if (pollRef.current) {
                clearInterval(pollRef.current)
                pollRef.current = null
              }
            } else if (
              realtimeStatus === 'CLOSED' ||
              realtimeStatus === 'CHANNEL_ERROR'
            ) {
              setStatus('disconnected')
              if (!pollRef.current) {
                pollRef.current = setInterval(
                  pollEvents,
                  REALTIME_POLL_INTERVAL_MS
                )
              }
            } else {
              setStatus('connecting')
            }
          }
        )
      } catch {
        setStatus('disconnected')
        pollRef.current = setInterval(pollEvents, REALTIME_POLL_INTERVAL_MS)
      }
    }

    pollEvents()
    setupRealtime()

    return () => {
      if (channel) {
        import('@/lib/supabase-broadcast').then(({ unsubscribeFromChannel }) =>
          unsubscribeFromChannel(channel!)
        )
      }
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
    }
  }, [restaurantId, addEvent, pollEvents])

  return { events, status, addEvent }
}
