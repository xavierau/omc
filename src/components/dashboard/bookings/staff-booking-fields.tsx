'use client'

/**
 * BOOK-013 S1/S2 (mockup frames 2, 4, 6): the staff booking form's fields.
 * Phone with the member line (an existing member of this restaurant, found
 * by the BOOK-008 member search; never created here, R17), name, a guests
 * stepper, date, the time slots with the guests left in each (BOOK-010
 * capacity; a full or stopped slot stays selectable, saving then shows the
 * rules prompt), Other time, notes and the Notify checkbox. An edit marks
 * the fields it changed. Decision 9 (AC-26): the phone is optional on a staff
 * booking; while it is empty Notify is off and disabled with a hint.
 */
import { useEffect, useState, type ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { Minus, Plus } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { DayCapacityBody } from '@/application/booking/booking-capacity'
import { searchMembers, type MemberOption } from './use-booking-member'
import type { StaffBookingForm } from './staff-booking-api'

const digits = (s: string) => s.replace(/\D/g, '')

/** The member whose phone is this one (last 8 digits, any formatting), or null. */
export function memberForPhone(members: MemberOption[], phone: string): MemberOption | null {
  const want = digits(phone).slice(-8)
  if (want.length < 8) return null
  return members.find((m) => digits(m.phone).endsWith(want)) ?? null
}

function useMemberLine(phone: string) {
  const [member, setMember] = useState<MemberOption | null>(null)
  useEffect(() => {
    const want = digits(phone)
    if (want.length < 8) return
    let live = true
    const timer = setTimeout(async () => {
      const found = await searchMembers(want.slice(-8))
      if (live) setMember(found ? memberForPhone(found, phone) : null)
    }, 300)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [phone])
  return digits(phone).length >= 8 ? member : null
}

function useDayCapacity(date: string) {
  const [day, setDay] = useState<DayCapacityBody | null>(null)
  useEffect(() => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return
    let live = true
    fetch(`/api/dashboard/bookings/capacity?date=${date}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => live && setDay(body as DayCapacityBody | null))
      .catch(() => live && setDay(null))
    return () => {
      live = false
    }
  }, [date])
  return day && day.date === date ? day : null
}

export function Field({ label, changed, error, children, htmlFor }: { label: string; changed?: boolean; error?: string; children: ReactNode; htmlFor?: string }) {
  const t = useTranslations('bookings.staff')
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="flex items-center gap-2 text-sm font-medium text-foreground">
        {label}
        {changed ? <span className="rounded-md bg-pending-soft px-1.5 text-xs font-medium text-pending-foreground">{t('changed')}</span> : null}
      </label>
      {children}
      {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
    </div>
  )
}

function SlotButton({ time, note, tone, selected, onPick }: { time: string; note: string | null; tone: 'ok' | 'low' | 'off'; selected: boolean; onPick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onPick}
      data-testid={`booking-form-slot-${time.replace(':', '')}`}
      className={cn(
        'flex min-h-11 cursor-pointer flex-col items-center justify-center rounded-lg border px-2 py-1 text-sm tabular-nums transition-colors focus-visible:outline-2 focus-visible:outline-ring',
        selected ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card hover:border-primary/50',
        !selected && tone === 'off' && 'text-muted-foreground'
      )}
    >
      <span className="font-semibold">{time}</span>
      {note ? <span className={cn('text-xs', !selected && tone === 'low' && 'text-pending-foreground', !selected && tone !== 'low' && 'text-muted-foreground')}>{note}</span> : null}
    </button>
  )
}

/** The booking being edited: its own guests are counted in its slot, so they go back into "left" there. */
export interface OwnSlot { date: string; time: string; partySize: number }

/** Guests left in a slot, with the edited booking's own guests given back in its own slot (null = no limit). */
export function slotLeft(slot: { time: string; guests: number; limit: number | null }, date: string, own?: OwnSlot): number | null {
  if (slot.limit === null) return null
  const mine = own && own.date === date && own.time.slice(0, 5) === slot.time ? own.partySize : 0
  return slot.limit - slot.guests + mine
}

function TimeSlots({ date, time, partySize, own, onTime }: { date: string; time: string; partySize: number; own?: OwnSlot; onTime: (time: string) => void }) {
  const t = useTranslations('bookings.staff')
  const day = useDayCapacity(date)
  const slots = (day?.periods ?? []).flatMap((p) => p.slots.map((s) => ({ ...s, stopped: s.stopped || p.stopped || !!day?.stopped, period: p })))
  const [other, setOther] = useState(false)
  const onGrid = slots.some((s) => s.time === time)
  const showOther = other || (time !== '' && !onGrid) || slots.length === 0
  return (
    <div className="flex flex-col gap-2">
      {slots.length > 0 ? (
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-4">
          {slots.map((s) => {
            const left = slotLeft(s, date, own)
            const tone = s.stopped || (left !== null && left < partySize) ? (s.stopped ? 'off' : 'low') : 'ok'
            const note = s.stopped ? t('stopped') : left === null ? null : left <= 0 ? t('full') : t('left', { count: left })
            return <SlotButton key={s.time} time={s.time} note={note} tone={tone} selected={time === s.time} onPick={() => (setOther(false), onTime(s.time))} />
          })}
        </div>
      ) : null}
      {showOther ? (
        <Input
          type="time"
          step={300}
          value={time}
          aria-label={t('otherTimeLabel')}
          onChange={(e) => onTime(e.target.value)}
          data-testid="booking-form-time"
          className="h-11 w-40"
        />
      ) : (
        <Button type="button" variant="ghost" className="self-start" onClick={() => setOther(true)} data-testid="booking-form-other-time">
          {t('otherTime')}
        </Button>
      )}
    </div>
  )
}

function GuestsStepper({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const t = useTranslations('bookings.staff')
  return (
    <div className="inline-flex items-center gap-2">
      <Button type="button" variant="outline" size="icon-lg" aria-label={t('fewer')} disabled={value <= 1} onClick={() => onChange(value - 1)}>
        <Minus aria-hidden />
      </Button>
      <Input
        inputMode="numeric"
        value={String(value)}
        aria-label={t('guests')}
        onChange={(e) => onChange(Number(e.target.value.replace(/\D/g, '')) || 0)}
        data-testid="booking-form-partySize"
        className="h-11 w-16 text-center tabular-nums"
      />
      <Button type="button" variant="outline" size="icon-lg" aria-label={t('more')} onClick={() => onChange(value + 1)}>
        <Plus aria-hidden />
      </Button>
    </div>
  )
}

export interface StaffBookingFieldsProps {
  mode: 'new' | 'edit'
  values: StaffBookingForm
  errors: Record<string, string>
  changed: Set<keyof StaffBookingForm>
  maxPartySize?: number
  own?: OwnSlot
  /** Decision 9 / R20: a new booking or a source 'staff' one; any other source keeps the phone required. */
  phoneOptional: boolean
  onChange: (values: StaffBookingForm) => void
}

export function StaffBookingFields({ mode, values, errors, changed, own, phoneOptional, onChange }: StaffBookingFieldsProps) {
  const t = useTranslations('bookings.staff')
  const member = useMemberLine(values.phone)
  const noPhone = values.phone.trim() === ''
  const set = <K extends keyof StaffBookingForm>(key: K, value: StaffBookingForm[K]) => onChange({ ...values, [key]: value })
  const err = (field: string) => {
    const code = errors[field]
    if (!code) return undefined
    if (field === 'phone' && code === 'invalid') return t('errors.phoneInvalid')
    return t.has(`errors.${code}`) ? t(`errors.${code}`) : t('errors.invalid')
  }
  return (
    <div className="flex flex-col gap-4">
      <Field label={t(phoneOptional ? 'phoneOptional' : 'phone')} htmlFor="booking-form-phone" changed={changed.has('phone')} error={err('phone')}>
        <Input
          id="booking-form-phone" type="tel" inputMode="tel" autoComplete="off" value={values.phone} placeholder={t('phonePlaceholder')}
          aria-invalid={!!errors.phone} onChange={(e) => set('phone', e.target.value)} data-testid="booking-form-phone" className="h-11"
        />
        {member ? (
          <p className="text-sm text-primary" data-testid="booking-form-member">{t('member', { name: member.name ?? member.phone })}</p>
        ) : null}
      </Field>
      <Field label={t('name')} htmlFor="booking-form-name" changed={changed.has('name')} error={err('name')}>
        <Input
          id="booking-form-name" value={values.name} maxLength={60} placeholder={t('namePlaceholder')} aria-invalid={!!errors.name}
          onChange={(e) => set('name', e.target.value)} data-testid="booking-form-name" className="h-11"
        />
      </Field>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label={t('guests')} changed={changed.has('partySize')} error={err('partySize')}>
          <GuestsStepper value={values.partySize} onChange={(n) => set('partySize', n)} />
        </Field>
        <Field label={t('date')} htmlFor="booking-form-date" changed={changed.has('date')} error={err('date')}>
          <Input
            id="booking-form-date" type="date" value={values.date} aria-invalid={!!errors.date}
            onChange={(e) => set('date', e.target.value)} data-testid="booking-form-date" className="h-11"
          />
        </Field>
      </div>
      <Field label={t('time')} changed={changed.has('time')} error={err('time')}>
        <TimeSlots date={values.date} time={values.time} partySize={values.partySize} own={own} onTime={(time) => set('time', time)} />
      </Field>
      <Field label={t('notes')} htmlFor="booking-form-notes" changed={changed.has('notes')} error={err('notes')}>
        <textarea
          id="booking-form-notes" value={values.notes} maxLength={500} rows={2} onChange={(e) => set('notes', e.target.value)}
          data-testid="booking-form-notes"
          className="w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm"
        />
      </Field>
      <NotifyCheck
        checked={values.notify && !noPhone} onChange={(v) => set('notify', v)} disabled={noPhone}
        label={t(mode === 'new' ? 'notifyCreate' : 'notifyEdit')}
        hint={t(noPhone ? 'notifyNoPhone' : mode === 'new' ? 'notifyCreateHint' : 'notifyEditHint')}
        testId="booking-form-notify"
      />
    </div>
  )
}

interface NotifyCheckProps {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  hint: string
  testId: string
  /** Decision 9: no phone, so nothing can be sent. */
  disabled?: boolean
}

export function NotifyCheck({ checked, onChange, label, hint, testId, disabled = false }: NotifyCheckProps) {
  return (
    <label className={cn('flex items-start gap-3 rounded-lg border border-border bg-muted/40 p-3', disabled ? 'cursor-not-allowed' : 'cursor-pointer')}>
      <input
        type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} data-testid={testId}
        className="mt-0.5 size-5 shrink-0 cursor-pointer accent-primary disabled:cursor-not-allowed disabled:opacity-50"
      />
      <span className="flex flex-col gap-0.5">
        <span className="text-sm font-medium text-foreground">{label}</span>
        <span className="text-sm text-muted-foreground">{hint}</span>
      </span>
    </label>
  )
}
