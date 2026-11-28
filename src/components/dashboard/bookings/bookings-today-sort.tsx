'use client'

/**
 * BOOK-013 AC-25 (mockup frames 7, 8): how staff sort the Today list.
 * Desktop: a header row Time | Name | Guests | Status | Action; each sortable
 * header is a button inside a columnheader, the active one carries aria-sort,
 * and selecting it again reverses it. Phone: one "Sort" select with both
 * directions of each key.
 */
import { useTranslations } from 'next-intl'
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { defaultTodaySortDir, TODAY_SORT_KEYS, type TodaySort, type TodaySortDir, type TodaySortKey } from '@/domain/services/booking-today-sort'

/** Shared by the header row and the desktop rows, so the columns line up. */
export const TODAY_COLUMNS = 'grid grid-cols-[4.5rem_minmax(0,1fr)_4.5rem_9.5rem_13rem] items-center gap-3'

function SortIcon({ active, dir }: { active: boolean; dir: TodaySortDir }) {
  if (!active) return <ArrowUpDown aria-hidden className="size-3.5 text-muted-foreground" />
  const Icon = dir === 'asc' ? ArrowUp : ArrowDown
  return <Icon aria-hidden className="size-3.5 text-primary" />
}

function SortHeader({ sortKey, sort, onSort }: { sortKey: TodaySortKey; sort: TodaySort; onSort: (key: TodaySortKey) => void }) {
  const t = useTranslations('bookings.today.sort')
  const active = sort.key === sortKey
  return (
    <div role="columnheader" aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
      <button
        type="button" onClick={() => onSort(sortKey)} data-testid={`bookings-today-sort-${sortKey}`}
        className={cn(
          'inline-flex h-10 cursor-pointer items-center gap-1.5 rounded-md text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring',
          active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
        )}
      >
        {t(sortKey)}
        <SortIcon active={active} dir={sort.dir} />
      </button>
    </div>
  )
}

export function TodaySortHeaderRow({ sort, onSort }: { sort: TodaySort; onSort: (key: TodaySortKey) => void }) {
  const t = useTranslations('bookings.today.sort')
  return (
    <div role="row" className={cn(TODAY_COLUMNS, 'border-b border-border px-5')}>
      {TODAY_SORT_KEYS.map((key) => <SortHeader key={key} sortKey={key} sort={sort} onSort={onSort} />)}
      <div role="columnheader" className="text-right text-sm font-semibold text-muted-foreground">{t('action')}</div>
    </div>
  )
}

const reverse = (dir: TodaySortDir): TodaySortDir => (dir === 'asc' ? 'desc' : 'asc')

/** Each key at its default direction first, then reversed. */
const OPTIONS: TodaySort[] = TODAY_SORT_KEYS.flatMap((key) => [
  { key, dir: defaultTodaySortDir(key) },
  { key, dir: reverse(defaultTodaySortDir(key)) },
])

const optionValue = (s: TodaySort) => `${s.key}:${s.dir}`

export function TodaySortSelect({ sort, onChange }: { sort: TodaySort; onChange: (sort: TodaySort) => void }) {
  const t = useTranslations('bookings.today.sort')
  return (
    <label className="flex min-h-11 items-center gap-2 rounded-lg border border-border bg-card px-3 text-sm text-muted-foreground">
      <span>{t('label')}</span>
      <select
        value={optionValue(sort)} data-testid="bookings-today-sort"
        onChange={(e) => onChange(OPTIONS.find((o) => optionValue(o) === e.target.value) ?? sort)}
        className="h-10 min-w-0 flex-1 cursor-pointer bg-transparent font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {OPTIONS.map((o) => <option key={optionValue(o)} value={optionValue(o)}>{t(`option.${o.key}_${o.dir}`)}</option>)}
      </select>
    </label>
  )
}
