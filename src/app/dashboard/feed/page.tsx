'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useTranslations } from 'next-intl'
import { ConnectionIndicator } from '@/components/dashboard/connection-indicator'
import { FeedContent } from '@/components/dashboard/feed-content'
import { useRealtimeEvents } from '@/hooks/use-realtime-events'
import { cn } from '@/lib/utils'

interface FeedEvent {
  id: string
  type: string
  member_name: string | null
  data_json: Record<string, unknown>
  created_at: string
}

export default function FeedPage() {
  const t = useTranslations('feed')
  const [fetchedEvents, setFetchedEvents] = useState<FeedEvent[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const { events: realtimeEvents, status } = useRealtimeEvents()

  const fetchEvents = useCallback(async () => {
    try {
      setIsLoading(true)
      setError(null)
      const params = new URLSearchParams({ limit: '50' })
      if (filter) params.set('type', filter)
      const res = await fetch(`/api/dashboard/events?${params}`)
      if (!res.ok) throw new Error('Failed to fetch')
      const json = await res.json()
      setFetchedEvents(json.events)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setIsLoading(false)
    }
  }, [filter])

  useEffect(() => {
    fetchEvents()
  }, [fetchEvents])

  const mergedEvents = useMergedEvents(realtimeEvents, fetchedEvents, filter)

  const filterOptions = [
    { label: t('filterAll'), value: '' },
    { label: t('filterJoins'), value: 'join' },
    { label: t('filterReceipts'), value: 'receipt' },
    { label: t('filterRedemptions'), value: 'redeem' },
    { label: t('filterPoints'), value: 'points' },
  ]

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-foreground">{t('heading')}</h1>
        <ConnectionIndicator status={status} />
      </div>
      <div className="flex gap-2 flex-wrap">
        {filterOptions.map((opt) => (
          <button
            key={opt.value}
            onClick={() => setFilter(opt.value)}
            aria-pressed={filter === opt.value}
            className={cn(
              'px-3 py-1.5 rounded-full text-sm font-medium transition-colors',
              filter === opt.value
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-muted/80'
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>
      <FeedContent events={mergedEvents} isLoading={isLoading} error={error} onRetry={fetchEvents} />
    </div>
  )
}

function useMergedEvents(
  realtimeEvents: ReturnType<typeof useRealtimeEvents>['events'],
  fetchedEvents: FeedEvent[],
  filter: string
) {
  return useMemo(() => {
    const fetchedIds = new Set(fetchedEvents.map((e) => e.id))
    const newRealtime = realtimeEvents
      .filter((e) => !fetchedIds.has(e.id))
      .filter((e) => !filter || e.type === filter)
      .map((e) => ({
        id: e.id,
        type: e.type,
        member_name: e.memberName,
        data_json: e.dataJson,
        created_at: e.createdAt,
      }))
    return [...newRealtime, ...fetchedEvents]
  }, [realtimeEvents, fetchedEvents, filter])
}
