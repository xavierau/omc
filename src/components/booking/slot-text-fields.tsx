/** BOOK-009 S2: name and notes on the slot form (notes with an example placeholder), errors under each field. */
import { useTranslations } from 'next-intl'
import { Input } from '@/components/ui/input'

export interface SlotTextFieldsProps {
  name: string
  notes: string
  errors: Record<string, string>
  onChange: (field: 'name' | 'notes', value: string) => void
}

function FieldError({ field, code }: { field: string; code?: string }) {
  const t = useTranslations('booking')
  return code ? <p id={`booking-${field}-error`} data-testid={`booking-field-error-${field}`} className="text-xs text-destructive">{t(`errors.${code}`)}</p> : null
}

export function SlotTextFields({ name, notes, errors, onChange }: SlotTextFieldsProps) {
  const t = useTranslations('booking')
  const described = (field: string) => (errors[field] ? `booking-${field}-error` : undefined)
  return (
    <div className="space-y-5">
      <div className="space-y-1.5">
        <label htmlFor="booking-name" className="text-base font-semibold text-foreground">{t('name')}</label>
        <Input id="booking-name" name="name" value={name} autoComplete="name" maxLength={60} required aria-invalid={Boolean(errors.name)}
          aria-describedby={described('name')} onChange={(e) => onChange('name', e.target.value)} data-testid="booking-name-input" className="h-11" />
        <FieldError field="name" code={errors.name} />
      </div>
      <div className="space-y-1.5">
        <label htmlFor="booking-notes" className="text-base font-semibold text-foreground">{t('notes')}</label>
        <textarea id="booking-notes" name="notes" value={notes} maxLength={500} rows={3} placeholder={t('picker.notesPlaceholder')}
          aria-invalid={Boolean(errors.notes)} aria-describedby={described('notes')} onChange={(e) => onChange('notes', e.target.value)}
          data-testid="booking-notes-input"
          className="w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-base outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive md:text-sm" />
        <FieldError field="notes" code={errors.notes} />
      </div>
    </div>
  )
}
