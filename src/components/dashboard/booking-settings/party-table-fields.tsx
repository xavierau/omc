'use client'

/**
 * BOOK-009 S1.5–S1.6: the existing party-size max, now with the line diners
 * see above it, and the table time (shown only, never enforced).
 */
import { useTranslations } from 'next-intl'
import { Eye } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { TABLE_MINUTES_OPTIONS, type TableMinutes } from '@/domain/value-objects/booking-hours'
import { Segmented } from './segmented'
import type { HoursEditProps } from './weekly-hours-table'

export interface PartyTableFieldsProps extends Omit<HoursEditProps, 'errors'> {
  maxPartySize: string
  onMaxPartySize: (value: string) => void
  maxPartyError?: string
}

export function PartyTableFields({ hours, onEdit, maxPartySize, onMaxPartySize, maxPartyError }: PartyTableFieldsProps) {
  const t = useTranslations('bookingSettings')
  const h = useTranslations('bookingSettings.bookingHours')
  const options = [{ value: null as TableMinutes | null, label: h('tableNone') },
    ...TABLE_MINUTES_OPTIONS.map((minutes) => ({ value: minutes as TableMinutes | null, label: h('tableOption', { minutes }) }))]
  return (
    <div className="grid gap-5 sm:grid-cols-2">
      <div className="space-y-1.5">
        <label htmlFor="booking-settings-max" className="text-sm font-medium">{t('maxPartySize')}</label>
        <Input id="booking-settings-max" type="number" min={1} max={100} className="w-28" value={maxPartySize}
          onChange={(e) => onMaxPartySize(e.target.value)} data-testid="booking-settings-max-party" />
        <p data-testid="booking-settings-party-line" className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Eye className="size-3.5" aria-hidden />{h('partyLine', { max: maxPartySize })}
        </p>
        {maxPartyError ? <p data-testid="booking-settings-max-party-error" className="text-xs text-destructive">{t(`errors.${maxPartyError}`)}</p> : null}
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium">{h('tableTime')}</p>
        <p className="text-xs text-muted-foreground">{h('tableTimeHint')}</p>
        <Segmented label={h('tableTime')} value={hours.tableMinutes} options={options} testId="booking-settings-table-time"
          onChange={(tableMinutes) => onEdit((x) => ({ ...x, tableMinutes }))} />
      </div>
    </div>
  )
}
