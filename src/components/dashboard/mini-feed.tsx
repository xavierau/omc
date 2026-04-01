import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'

interface FeedEvent {
  id: string
  type: string
  memberName: string | null
  createdAt: string
}

const typeColors: Record<string, string> = {
  join: 'bg-blue-500',
  redeem: 'bg-brand-success',
  receipt: 'bg-brand-accent',
  points: 'bg-brand-primary',
  campaign: 'bg-purple-500',
}

interface MiniFeedProps {
  events: FeedEvent[]
}

export function MiniFeed({ events }: MiniFeedProps) {
  const te = useTranslations('events')
  const tt = useTranslations('time')
  const tc = useTranslations('common')
  const tf = useTranslations('feed')

  function timeAgo(dateStr: string): string {
    const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000)
    if (seconds < 60) return tt('justNow')
    const minutes = Math.floor(seconds / 60)
    if (minutes < 60) return tt('minutesAgo', { count: minutes })
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return tt('hoursAgo', { count: hours })
    const days = Math.floor(hours / 24)
    return tt('daysAgo', { count: days })
  }

  function getTypeLabel(type: string): string {
    const eventTypes = ['join', 'redeem', 'receipt', 'points', 'campaign'] as const
    if (eventTypes.includes(type as typeof eventTypes[number])) {
      return te(type as typeof eventTypes[number])
    }
    return type
  }

  if (events.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        {tf('waitingTitle')}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {events.slice(0, 5).map((event) => (
        <div key={event.id} className="flex items-center gap-3">
          <div className={cn('w-2 h-2 rounded-full shrink-0', typeColors[event.type] || 'bg-gray-400')} />
          <div className="flex-1 min-w-0">
            <p className="text-sm text-foreground truncate">
              <span className="font-medium">{event.memberName || tc('unknown')}</span>{' '}
              {getTypeLabel(event.type)}
            </p>
          </div>
          <span className="text-xs text-muted-foreground shrink-0">{timeAgo(event.createdAt)}</span>
        </div>
      ))}
    </div>
  )
}
