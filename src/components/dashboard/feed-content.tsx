import { useTranslations } from 'next-intl'
import { EventFeedItem } from '@/components/dashboard/event-feed-item'
import { Button } from '@/components/ui/button'

interface FeedEvent {
  id: string
  type: string
  member_name: string | null
  data_json: Record<string, unknown>
  created_at: string
}

export function FeedContent({
  events,
  isLoading,
  error,
  onRetry,
}: {
  events: FeedEvent[]
  isLoading: boolean
  error: string | null
  onRetry: () => void
}) {
  const t = useTranslations('feed')

  if (error) {
    return (
      <div className="text-center py-8">
        <p className="text-muted-foreground">{t('disconnected')}</p>
        <Button variant="outline" onClick={onRetry} className="mt-4">{t('reconnect')}</Button>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="h-12 bg-muted/50 rounded animate-pulse" />
        ))}
      </div>
    )
  }

  if (events.length === 0) {
    return (
      <div className="text-center py-12">
        <div className="w-3 h-3 rounded-full bg-brand-primary animate-pulse mx-auto mb-4" />
        <p className="text-muted-foreground">{t('waitingTitle')}</p>
        <p className="text-xs text-muted-foreground mt-1 opacity-60">
          {t('waitingHint')}
        </p>
      </div>
    )
  }

  return (
    <div className="divide-y">
      {events.map((event) => (
        <EventFeedItem
          key={event.id}
          type={event.type}
          memberName={event.member_name}
          dataJson={event.data_json}
          createdAt={event.created_at}
        />
      ))}
    </div>
  )
}
