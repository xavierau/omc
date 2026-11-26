'use client'

/**
 * BOOK-004: page title, the "N requests need a reply · Show" pill, and the Calendar | Table toggle.
 * BOOK-013: Today | Calendar | Table, the "+ New booking" button, and the Today heading line.
 */
import { useLocale, useTranslations } from 'next-intl'
import { CalendarDays, ListChecks, Plus, Table2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { BOOKINGS_VIEWS, type BookingsView } from './bookings-view-state'
import { formatDate } from './booking-dates'

const VIEW_ICON = { today: ListChecks, calendar: CalendarDays, table: Table2 } as const

function NeedsReplyPill({ count, onShow }: { count: number; onShow: () => void }) {
  const t = useTranslations('bookings.views')
  return (
    <button
      type="button"
      onClick={onShow}
      data-testid="bookings-needs-reply"
      className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg border border-accent/40 bg-pending-soft px-3 text-sm font-medium text-pending-foreground hover:bg-accent/15 focus-visible:outline-2 focus-visible:outline-ring"
    >
      <span aria-hidden className="size-2 rounded-full bg-accent" />
      <span className="hidden sm:inline">{t('needsReply', { count })}</span>
      <span className="sm:hidden">{t('needsReplyShort', { count })}</span>
      <span className="font-normal underline-offset-2 sm:no-underline">{t('show')}</span>
    </button>
  )
}

function ViewToggle({ view, onView }: { view: BookingsView; onView: (view: BookingsView) => void }) {
  const t = useTranslations('bookings.views')
  return (
    <div role="group" aria-label={t('viewLabel')} className="grid w-full grid-cols-3 gap-1 rounded-lg border border-border bg-muted p-1 md:inline-grid md:w-auto">
      {BOOKINGS_VIEWS.map((v) => {
        const Icon = VIEW_ICON[v]
        const active = v === view
        return (
          <button
            key={v}
            type="button"
            aria-pressed={active}
            onClick={() => onView(v)}
            data-testid={`bookings-view-${v}`}
            className={cn(
              'inline-flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded-md px-3 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-ring',
              active ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <Icon aria-hidden className="size-4" />
            {t(v)}
          </button>
        )
      })}
    </div>
  )
}

export interface BookingsHeaderProps {
  view: BookingsView
  pendingCount: number
  today: string
  onView: (view: BookingsView) => void
  onShowPending: () => void
  onNew: () => void
}

function NewButton({ onNew }: { onNew: () => void }) {
  const t = useTranslations('bookings.staff')
  return (
    <Button onClick={onNew} data-testid="booking-new-button" className="h-9">
      <Plus aria-hidden />
      <span className="hidden sm:inline">{t('newBooking')}</span>
      <span className="sm:hidden">{t('newShort')}</span>
    </Button>
  )
}

export function BookingsHeader({ view, pendingCount, today, onView, onShowPending, onNew }: BookingsHeaderProps) {
  const t = useTranslations('bookings')
  const locale = useLocale()
  const description = view === 'today'
    ? t('today.heading', { date: formatDate(today, locale, { weekday: 'long', day: 'numeric', month: 'long' }) })
    : t('description')
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 md:flex-nowrap md:items-start md:gap-4">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold text-foreground">{t('heading')}</h1>
        <p className="mt-1 hidden text-muted-foreground md:block">{description}</p>
      </div>
      {/* Phone: New and the pill sit beside the title and the toggle wraps full width; desktop: one control group. */}
      <div className="contents md:flex md:items-center md:gap-3">
        <span className="flex items-center gap-2 md:contents">
          {pendingCount > 0 ? <NeedsReplyPill count={pendingCount} onShow={onShowPending} /> : null}
          <span className="md:hidden"><NewButton onNew={onNew} /></span>
        </span>
        <ViewToggle view={view} onView={onView} />
        <span className="hidden md:inline-flex"><NewButton onNew={onNew} /></span>
      </div>
    </div>
  )
}
