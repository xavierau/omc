'use client'

/**
 * BOOK-010 S3 (spec AC-8, AC-9; S1 mockup): the day panel's Capacity block,
 * above the booking rows: "Accepting bookings" with the whole-day switch,
 * then one card per period. A switch that is on accepts bookings; turning it
 * off stops them for diners and agents (never staff). Nothing renders when
 * the restaurant has no booking hours.
 */
import { useTranslations } from 'next-intl'
import { Switch } from '@/components/ui/switch'
import type { CapacityPeriod } from '@/domain/services/booking-capacity'
import type { BookingItem } from '@/hooks/use-bookings'
import { pendingInPeriod, type CapacityDayView, type PendingNote, type useBookingCapacity } from './use-booking-capacity'
import { CapacityPeriodCard, StoppedLine, type ToggleStop } from './capacity-period'

export interface CapacityBlockProps {
  day: CapacityDayView
  error: boolean
  note: PendingNote | null
  onToggle: ToggleStop
  /** Pending requests in a period (the inline note after stopping it). */
  pendingIn?: (period: CapacityPeriod) => number
}

export function CapacityBlock({ day, error, note, onToggle, pendingIn = () => 0 }: CapacityBlockProps) {
  const t = useTranslations('bookings.capacity')
  if (!day.hoursSet || day.periods.length === 0) return null
  return (
    <section data-testid="bookings-capacity" aria-labelledby="bookings-capacity-title" className="space-y-3 border-b border-border bg-muted/30 px-4 py-4 sm:px-5">
      <div className="flex items-center gap-3">
        <h3 id="bookings-capacity-title" className="font-semibold text-foreground">{t('title')}</h3>
        <span className="ml-auto text-sm text-muted-foreground">{t('wholeDay')}</span>
        <Switch checked={!day.stopped} onCheckedChange={(on) => onToggle({ scope: 'day' }, !on)} aria-label={t('acceptDay')} data-testid="bookings-capacity-day-stop" />
      </div>
      <StoppedLine info={day} testId="bookings-capacity-day-stopped" />
      <div className="space-y-2">
        {day.periods.map((p) => <CapacityPeriodCard key={p.key} period={p} note={note} pending={pendingIn(p)} onToggle={onToggle} />)}
      </div>
      {error ? <p data-testid="bookings-capacity-error" role="alert" className="text-xs text-destructive">{t('error')}</p> : null}
    </section>
  )
}

/** The screen's wiring: the loaded day (nothing while it loads or when it failed), pending counts from all of that day's rows. */
export function DayCapacity({ capacity, bookings, date }: { capacity: ReturnType<typeof useBookingCapacity>; bookings: BookingItem[]; date: string }) {
  if (!capacity.day) return null
  return (
    <CapacityBlock day={capacity.day} error={capacity.error} note={capacity.note} onToggle={capacity.toggle}
      pendingIn={(p) => pendingInPeriod(bookings, date, p)} />
  )
}
