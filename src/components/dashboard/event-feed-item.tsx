import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'

interface EventFeedItemProps {
  type: string
  memberName: string | null
  dataJson: Record<string, unknown>
  createdAt: string
}

const typeColors: Record<string, string> = {
  join: 'bg-blue-500',
  redeem: 'bg-brand-success',
  receipt: 'bg-brand-accent',
  points: 'bg-brand-primary',
  campaign: 'bg-purple-500',
  unsubscribe: 'bg-brand-danger',
}

export function EventFeedItem({ type, memberName, dataJson, createdAt }: EventFeedItemProps) {
  const te = useTranslations('events')
  const tt = useTranslations('time')
  const tc = useTranslations('common')

  const color = typeColors[type] || 'bg-gray-400'
  const eventTypes = ['join', 'redeem', 'receipt', 'points', 'campaign', 'unsubscribe'] as const
  const label = eventTypes.includes(type as typeof eventTypes[number])
    ? te(type as typeof eventTypes[number])
    : type

  function getDetail(): string {
    if (type === 'points' && dataJson.amount) return te('pointsDetail', { amount: String(dataJson.amount) })
    if (type === 'redeem' && dataJson.coupon_code) return te('codeDetail', { code: String(dataJson.coupon_code) })
    return ''
  }

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

  const detail = getDetail()

  return (
    <div className="flex items-start gap-3 py-3">
      <div className={cn('w-2.5 h-2.5 rounded-full shrink-0 mt-1.5', color)} />
      <div className="flex-1 min-w-0">
        <p className="text-sm text-foreground">
          <span className="font-medium">{memberName || tc('unknown')}</span>{' '}
          <span className="text-muted-foreground">{label}</span>
        </p>
        {detail && <p className="text-xs text-muted-foreground mt-0.5">{detail}</p>}
      </div>
      <span className="text-xs text-muted-foreground shrink-0">{timeAgo(createdAt)}</span>
    </div>
  )
}
