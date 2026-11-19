'use client'

/** BOOK-004: status chips with counts for the loaded range, and the name/phone search (client-side). */
import { useTranslations } from 'next-intl'
import { Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { STATUS_FILTERS, type StatusFilter } from './booking-groups'

export interface BookingsFiltersProps {
  status: StatusFilter
  counts: Record<StatusFilter, number>
  query: string
  showSearch: boolean
  onStatus: (status: StatusFilter) => void
  onQuery: (query: string) => void
}

export function BookingsFilters({ status, counts, query, showSearch, onStatus, onQuery }: BookingsFiltersProps) {
  const t = useTranslations('bookings.views')
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div role="group" aria-label={t('statusLabel')} className="flex flex-wrap gap-1.5">
        {STATUS_FILTERS.map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={s === status}
            onClick={() => onStatus(s)}
            data-testid={`bookings-filter-${s}`}
            className={cn(
              'inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border px-3 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-ring',
              s === status ? 'border-foreground bg-foreground text-background' : 'border-border bg-card text-foreground hover:bg-muted'
            )}
          >
            {t(`filter.${s}`)}
            {s === 'all' ? null : <span className={cn('tabular-nums', s === status ? 'text-background/70' : 'text-muted-foreground')}>{counts[s]}</span>}
          </button>
        ))}
      </div>
      {showSearch ? (
        <div className="relative w-full sm:w-56">
          <Search aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder={t('searchPlaceholder')}
            aria-label={t('searchPlaceholder')}
            data-testid="bookings-search"
            className="h-8 bg-card pl-8"
          />
        </div>
      ) : null}
    </div>
  )
}
