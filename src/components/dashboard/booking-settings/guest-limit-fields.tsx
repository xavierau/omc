'use client'

/**
 * BOOK-010 S1 (A3 mockup): 人數上限. Guests per time slot and per meal, both
 * optional (empty = no limit), saved with the section's Save. Errors come
 * back per path from the PUT (`bookingHours.limits.perSlot|perMeal`, or the
 * whole `bookingHours.limits`, shown on the slot field).
 */
import { useTranslations } from 'next-intl'
import { Info } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { fieldError, type SettingsErrors } from './hours-errors'
import { HoursFieldError } from './block'

export type LimitField = 'limitPerSlot' | 'limitPerMeal'

export interface GuestLimitFieldsProps {
  perSlot: string
  perMeal: string
  errors: SettingsErrors
  onChange: (field: LimitField, value: string) => void
}

const KNOWN = new Set(['invalid', 'above_meal'])

interface LimitInputProps {
  id: 'slot' | 'meal'
  value: string
  error: string | null
  onChange: (value: string) => void
}

function LimitInput({ id, value, error, onChange }: LimitInputProps) {
  const t = useTranslations('bookingSettings.bookingHours.limits')
  const name = id === 'slot' ? 'perSlot' : 'perMeal'
  const testId = `booking-settings-limit-${id}`
  return (
    <div className="space-y-1.5">
      <label htmlFor={testId} className="text-sm font-medium">{t(name)}</label>
      <p id={`${testId}-hint`} className="text-xs text-muted-foreground">{t(`${name}Hint`)}</p>
      <div className="flex items-center gap-2">
        <Input id={testId} type="number" inputMode="numeric" min={1} max={999} step={1} className="w-28" value={value}
          aria-describedby={`${testId}-hint`} aria-invalid={error ? true : undefined} onChange={(e) => onChange(e.target.value)} data-testid={testId} />
        <span className="text-sm text-muted-foreground">{t('unit')}</span>
      </div>
      <HoursFieldError message={error ? t(`errors.${KNOWN.has(error) ? error : 'invalid'}`) : null} testId={`${testId}-error`} />
    </div>
  )
}

export function GuestLimitFields({ perSlot, perMeal, errors, onChange }: GuestLimitFieldsProps) {
  const t = useTranslations('bookingSettings.bookingHours.limits')
  const slotError = fieldError(errors, 'limits.perSlot') ?? fieldError(errors, 'limits')
  return (
    <div className="space-y-4">
      <div className="grid gap-5 sm:grid-cols-2">
        <LimitInput id="slot" value={perSlot} error={slotError} onChange={(v) => onChange('limitPerSlot', v)} />
        <LimitInput id="meal" value={perMeal} error={fieldError(errors, 'limits.perMeal')} onChange={(v) => onChange('limitPerMeal', v)} />
      </div>
      <p data-testid="booking-settings-limit-example" className="flex items-start gap-2 rounded-lg bg-primary/5 px-3 py-2.5 text-xs text-primary">
        <Info className="mt-px size-3.5 shrink-0" aria-hidden />{t('example')}
      </p>
    </div>
  )
}
