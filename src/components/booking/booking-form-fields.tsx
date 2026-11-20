/**
 * BOOK-001: the booking form's inputs and their per-field errors (AC-9, AC-11).
 * Presentational: values, errors and change handlers come from BookingForm.
 */
import { useTranslations } from 'next-intl'
import { Input } from '@/components/ui/input'
import type { BookingFormValues } from './booking-form-client'

export interface BookingFormFieldsProps {
  values: BookingFormValues
  errors: Record<string, string>
  today: string
  maxPartySize: number
  onChange: (field: keyof BookingFormValues, value: string) => void
}

function FieldError({ field, code, max }: { field: string; code?: string; max: number }) {
  const t = useTranslations('booking')
  if (!code) return null
  return (
    <p id={`booking-${field}-error`} data-testid={`booking-field-error-${field}`} className="text-xs text-destructive">
      {t(`errors.${code}`, { max })}
    </p>
  )
}

function Field(props: { field: keyof BookingFormValues; label: string; children: React.ReactNode } & Pick<BookingFormFieldsProps, 'errors' | 'maxPartySize'>) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={`booking-${props.field}`} className="text-sm font-medium text-foreground">
        {props.label}
      </label>
      {props.children}
      <FieldError field={props.field} code={props.errors[props.field]} max={props.maxPartySize} />
    </div>
  )
}

export function BookingFormFields({ values, errors, today, maxPartySize, onChange }: BookingFormFieldsProps) {
  const t = useTranslations('booking')
  const input = (field: keyof BookingFormValues) => ({
    id: `booking-${field}`,
    name: field,
    value: values[field],
    'aria-invalid': Boolean(errors[field]),
    'aria-describedby': errors[field] ? `booking-${field}-error` : undefined,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(field, e.target.value),
    className: 'h-11',
  })
  const shared = { errors, maxPartySize }
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Field field="date" label={t('date')} {...shared}>
          <Input {...input('date')} type="date" min={today} required data-testid="booking-date-input" />
        </Field>
        <Field field="time" label={t('time')} {...shared}>
          <Input {...input('time')} type="time" required data-testid="booking-time-input" />
        </Field>
      </div>
      <Field field="partySize" label={t('partySize')} {...shared}>
        <Input {...input('partySize')} type="number" inputMode="numeric" min={1} max={maxPartySize} required data-testid="booking-party-size-input" />
      </Field>
      <Field field="name" label={t('name')} {...shared}>
        <Input {...input('name')} autoComplete="name" maxLength={60} required data-testid="booking-name-input" />
      </Field>
      <Field field="notes" label={t('notes')} {...shared}>
        <textarea
          {...input('notes')}
          maxLength={500}
          rows={3}
          data-testid="booking-notes-input"
          className="w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-base outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive md:text-sm"
        />
      </Field>
    </div>
  )
}
