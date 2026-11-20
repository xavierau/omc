'use client'

/**
 * BOOK-009 AC-6: the chosen day's slots as buttons, grouped by period label
 * (unlabelled: 中午 / 下午 / 晚上), then the table time. The slots come from
 * the shared `slotsFor`, so every button is a time the server accepts now.
 */
import { useTranslations } from 'next-intl'
import { Timer } from 'lucide-react'
import { slotsFor, type BookingClock } from '@/domain/services/booking-hours'
import type { BookingHours } from '@/domain/value-objects/booking-hours'
import { groupSlots } from './slot-picker-model'
import { chipClass } from './chip'

export interface SlotListProps {
  hours: BookingHours
  clock: BookingClock
  date: string
  value: string
  onChange: (time: string) => void
}

export function SlotList({ hours, clock, date, value, onChange }: SlotListProps) {
  const t = useTranslations('booking.picker')
  if (!date) return <p className="text-sm text-muted-foreground">{t('pickDayFirst')}</p>
  const groups = groupSlots(slotsFor(hours, date, clock))
  if (groups.length === 0) return <p data-testid="booking-no-slots" className="text-sm text-muted-foreground">{t('noTimesDay')}</p>
  return (
    <div className="space-y-4">
      {groups.map((g) => (
        <div key={`${g.label ?? g.fallback}-${g.slots[0].time}`} role="group" aria-label={g.label ?? t(`groups.${g.fallback}`)} className="space-y-2">
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="font-semibold text-foreground">{g.label ?? t(`groups.${g.fallback}`)}</span>
            <span className="tabular-nums">{g.slots[0].time}–{g.slots[g.slots.length - 1].time}</span>
            <span className="h-px flex-1 bg-border" aria-hidden />
          </p>
          <div className="grid grid-cols-4 gap-2">
            {g.slots.map((s) => (
              <button key={s.time} type="button" aria-pressed={s.time === value} onClick={() => onChange(s.time)}
                data-testid={`booking-slot-${s.time.replace(':', '')}`} className={`${chipClass(s.time === value)} h-11 text-base`}>
                {s.time}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

export function TableTime({ minutes }: { minutes: number | null }) {
  const t = useTranslations('booking.picker')
  if (!minutes) return null
  return (
    <p data-testid="booking-table-time" className="flex items-center gap-2 rounded-lg bg-primary/5 px-3 py-2.5 text-sm font-medium text-primary">
      <Timer className="size-4" aria-hidden />{t('tableTime', { duration: t('duration', { minutes }) })}
    </p>
  )
}
