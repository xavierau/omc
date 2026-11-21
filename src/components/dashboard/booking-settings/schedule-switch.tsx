'use client'

/**
 * BOOK-009 F1 (P2-1 ruling): "Use booking hours / 使用訂座時段". Off = diners
 * pick any date and time on every channel; terms, info and table time still
 * apply. On = the hours, window and special dates below bind every channel.
 */
import { useTranslations } from 'next-intl'
import { Switch } from '@/components/ui/switch'

export function ScheduleSwitch({ on, onChange }: { on: boolean; onChange: (on: boolean) => void }) {
  const t = useTranslations('bookingSettings.bookingHours')
  return (
    <label className="flex min-h-11 items-center gap-3 text-sm font-medium text-foreground">
      <Switch checked={on} onCheckedChange={onChange} data-testid="booking-settings-schedule-switch" />
      {t('scheduleSwitch')}
    </label>
  )
}
