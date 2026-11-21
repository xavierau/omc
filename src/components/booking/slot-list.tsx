'use client'

/**
 * BOOK-009 AC-6: the chosen day's slots as buttons, grouped by period label
 * (unlabelled: 中午 / 下午 / 晚上), then the table time. The slots come from
 * the shared `slotsFor`, so every button is a time the server accepts now.
 * BOOK-010 AC-12: a slot that cannot take the party stays visible, greyed,
 * marked 已滿 (data-state="full", aria-disabled) and cannot be picked.
 */
import { useTranslations } from 'next-intl'
import { Info, Timer } from 'lucide-react'
import { cn } from '@/lib/utils'
import { slotsFor, type BookingClock } from '@/domain/services/booking-hours'
import type { BookingHours } from '@/domain/value-objects/booking-hours'
import type { BookingSlot } from '@/domain/services/booking-hours'
import type { SlotFits } from '@/domain/services/booking-room'
import { groupSlots } from './slot-picker-model'
import { chipClass } from './chip'

export interface SlotListProps {
  hours: BookingHours
  clock: BookingClock
  date: string
  value: string
  onChange: (time: string) => void
  /** BOOK-010: whether a slot can take the chosen party (absent = every slot can). */
  fits?: SlotFits
  /** The chosen party (named in the 已滿 hint). */
  party?: number | null
}

function SlotButton({ slot, full, selected, onPick }: { slot: BookingSlot; full: boolean; selected: boolean; onPick: () => void }) {
  const t = useTranslations('booking.picker')
  return (
    <button type="button" disabled={full} aria-disabled={full} aria-pressed={selected} onClick={onPick}
      aria-label={full ? `${slot.time} ${t('full')}` : undefined}
      data-testid={`booking-slot-${slot.time.replace(':', '')}`} data-state={full ? 'full' : 'open'}
      className={cn(chipClass(selected), 'h-11 text-base', full && 'h-auto min-h-11 flex-col gap-0 border-transparent bg-muted py-1 leading-tight text-muted-foreground')}>
      {slot.time}
      {full ? <span className="text-[11px] font-normal">{t('full')}</span> : null}
    </button>
  )
}

export function SlotList({ hours, clock, date, value, onChange, fits, party = null }: SlotListProps) {
  const t = useTranslations('booking.picker')
  if (!date) return <p className="text-sm text-muted-foreground">{t('pickDayFirst')}</p>
  const slots = slotsFor(hours, date, clock)
  const groups = groupSlots(slots)
  if (groups.length === 0) return <p data-testid="booking-no-slots" className="text-sm text-muted-foreground">{t('noTimesDay')}</p>
  const isFull = (time: string) => (fits ? !fits(date, time) : false)
  return (
    <div className="space-y-4">
      {slots.some((s) => isFull(s.time)) ? (
        <p data-testid="booking-full-hint" className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <Info className="mt-px size-3.5 shrink-0" aria-hidden />{t('fullHint', { party: party ?? 1 })}
        </p>
      ) : null}
      {groups.map((g) => (
        <div key={`${g.label ?? g.fallback}-${g.slots[0].time}`} role="group" aria-label={g.label ?? t(`groups.${g.fallback}`)} className="space-y-2">
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="font-semibold text-foreground">{g.label ?? t(`groups.${g.fallback}`)}</span>
            <span className="tabular-nums">{g.slots[0].time}–{g.slots[g.slots.length - 1].time}</span>
            <span className="h-px flex-1 bg-border" aria-hidden />
          </p>
          <div className="grid grid-cols-4 gap-2">
            {g.slots.map((s) => (
              <SlotButton key={s.time} slot={s} full={isFull(s.time)} selected={s.time === value} onPick={() => onChange(s.time)} />
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
