'use client'

/**
 * BOOK-010 S3 (S1 mockup): one period of the Capacity block, "26 / 60
 * guests" with a bar (only with a meal limit), its stop switch, and its slots
 * when expanded ("19:00 · 30 / 30 · Full", a stop switch each). A period
 * with a full or stopped slot starts expanded. A full period says so (Full,
 * bar in the full colour); when only its meal limit is reached its slots
 * read "N / limit · Meal full", and "Full" stays for a slot that is itself
 * full or stopped (I-010).
 */
import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { ChevronRight, CirclePause } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Switch } from '@/components/ui/switch'
import { slotBadge, type CapacityPeriod, type CapacitySlot, type SlotBadge, type StopInfo } from '@/domain/services/booking-capacity'
import { capacityTestKey, hkClock, type PendingNote, type StopChoice } from './use-booking-capacity'

export type ToggleStop = (choice: StopChoice, stopped: boolean, pending?: number) => void

export function StoppedLine({ info, testId }: { info: StopInfo; testId: string }) {
  const t = useTranslations('bookings.capacity')
  if (!info.stopped || !info.stoppedAt) return null
  const time = hkClock(info.stoppedAt)
  return (
    <p data-testid={testId} className="flex items-center gap-1.5 text-xs text-destructive">
      <CirclePause className="size-3.5 shrink-0" aria-hidden />
      {info.stoppedBy ? t('stoppedBy', { name: info.stoppedBy, time }) : t('stoppedAt', { time })}
    </p>
  )
}

const BADGE = 'rounded-full bg-pending-soft px-2 py-0.5 text-xs font-semibold text-pending-foreground'

function FullBadge({ badge, testId }: { badge: SlotBadge; testId: string }) {
  const t = useTranslations('bookings.capacity')
  if (badge === 'full') return <span data-testid={`${testId}-full`} className={BADGE}>{t('full')}</span>
  if (badge === 'meal_full') return <span data-testid={`${testId}-meal-full`} className={BADGE}>{t('mealFull')}</span>
  return null
}

function SlotRow({ slot, badge, onToggle }: { slot: CapacitySlot; badge: SlotBadge; onToggle: ToggleStop }) {
  const t = useTranslations('bookings.capacity')
  const id = `bookings-capacity-slot-${capacityTestKey(slot.time)}`
  return (
    <li className="space-y-1 py-1.5">
      <div className="flex items-center gap-3">
        <span className="w-12 text-sm font-semibold tabular-nums text-foreground">{slot.time}</span>
        <span className="text-sm tabular-nums text-muted-foreground">
          {slot.limit === null ? t('slotGuests', { guests: slot.guests }) : t('slotOf', { guests: slot.guests, limit: slot.limit })}
        </span>
        <FullBadge badge={badge} testId={id} />
        <span className="ml-auto" />
        <Switch checked={!slot.stopped} onCheckedChange={(on) => onToggle({ scope: 'slot', time: slot.time }, !on)}
          aria-label={t('accept', { name: slot.time })} data-testid={`${id}-stop`} />
      </div>
      <StoppedLine info={slot} testId={`${id}-stopped`} />
    </li>
  )
}

function GuestsBar({ guests, limit, full, testId }: { guests: number; limit: number; full: boolean; testId: string }) {
  const width = Math.min(100, Math.round((guests / limit) * 100))
  return (
    <div data-testid={testId} data-state={full ? 'full' : 'open'} aria-hidden className="h-1.5 overflow-hidden rounded-full bg-muted">
      <div className={cn('h-full rounded-full', full ? 'bg-pending-foreground' : 'bg-primary')} style={{ width: `${width}%` }} />
    </div>
  )
}

export interface CapacityPeriodCardProps {
  period: CapacityPeriod
  note: PendingNote | null
  pending: number
  onToggle: ToggleStop
}

export function CapacityPeriodCard({ period, note, pending, onToggle }: CapacityPeriodCardProps) {
  const t = useTranslations('bookings.capacity')
  const [open, setOpen] = useState(() => period.slots.some((s) => s.full || s.stopped))
  const id = `bookings-capacity-period-${capacityTestKey(period.key)}`
  const name = period.label ?? `${period.first}–${period.last}`
  return (
    <div data-testid={id} data-state={period.stopped ? 'stopped' : period.full ? 'full' : 'open'} className="space-y-2 rounded-lg border border-border bg-card px-3 py-2.5">
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label={t('showSlots', { name })} data-testid={`${id}-toggle`}
          className="-ml-1 inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring">
          <ChevronRight className={cn('size-4 transition-transform', open && 'rotate-90')} aria-hidden />
        </button>
        <span className="font-semibold text-foreground">{name}</span>
        <span className="truncate text-sm tabular-nums text-muted-foreground">
          {period.limit === null ? t('guests', { guests: period.guests }) : t('guestsOf', { guests: period.guests, limit: period.limit })}
        </span>
        {period.full && !period.stopped ? <span data-testid={`${id}-full`} className={cn(BADGE, 'shrink-0')}>{t('full')}</span> : null}
        <span className="ml-auto" />
        <Switch checked={!period.stopped} onCheckedChange={(on) => onToggle({ scope: 'period', periodLabel: period.key }, !on, pending)}
          aria-label={t('accept', { name })} data-testid={`${id}-stop`} />
      </div>
      {period.limit !== null ? <GuestsBar guests={period.guests} limit={period.limit} full={period.full} testId={`${id}-bar`} /> : null}
      <StoppedLine info={period} testId={`${id}-stopped`} />
      {note && note.key === period.key ? (
        <p data-testid="bookings-capacity-pending-note" role="status" className="text-xs text-pending-foreground">{t('pendingNote', { count: note.count })}</p>
      ) : null}
      {open ? (
        <ul className="pl-7">
          {period.slots.map((s) => <SlotRow key={s.time} slot={s} badge={slotBadge(period, s)} onToggle={onToggle} />)}
        </ul>
      ) : null}
    </div>
  )
}
