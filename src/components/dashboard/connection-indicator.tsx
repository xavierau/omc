import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'

interface ConnectionIndicatorProps {
  status: 'connected' | 'connecting' | 'disconnected'
}

const statusColors = {
  connected: 'bg-brand-success',
  connecting: 'bg-brand-accent',
  disconnected: 'bg-brand-danger',
}

export function ConnectionIndicator({ status }: ConnectionIndicatorProps) {
  const t = useTranslations('connection')

  const labelMap = {
    connected: t('live'),
    connecting: t('connecting'),
    disconnected: t('offline'),
  }

  return (
    <div className="flex items-center gap-1.5">
      <div
        className={cn(
          'w-2 h-2 rounded-full',
          statusColors[status],
          status === 'connected' && 'animate-pulse'
        )}
      />
      <span className="text-xs text-muted-foreground">{labelMap[status]}</span>
    </div>
  )
}
