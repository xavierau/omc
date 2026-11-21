/**
 * BOOK-009 (owner default, D3 mockup): the sent state keeps the BOOK-001
 * title and body and adds the request summary, and "Terms accepted" when the
 * diner ticked them.
 */
import { useTranslations } from 'next-intl'
import { Check, ShieldCheck } from 'lucide-react'
import { dayLabel } from './booking-date-label'
import type { SlotFormValues } from '@/hooks/use-booking-slot-form'

export function SlotBookingSent({ values, termsAccepted }: { values: SlotFormValues; termsAccepted: boolean }) {
  const t = useTranslations('booking')
  const rows: [string, string][] = [
    [t('date'), dayLabel(t, values.date)],
    [t('time'), values.time],
    [t('partySize'), t('picker.partyChip', { n: values.partySize ?? 0 })],
    [t('name'), values.name.trim()],
  ]
  return (
    <div data-testid="booking-sent" role="status" className="space-y-4 text-center">
      <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary"><Check className="size-6" aria-hidden /></span>
      <h2 className="text-lg font-semibold text-foreground">{t('sentTitle')}</h2>
      <dl data-testid="booking-sent-summary" className="space-y-1.5 rounded-lg bg-muted p-3 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-4"><dt className="text-muted-foreground">{k}</dt><dd className="font-semibold text-foreground">{v}</dd></div>
        ))}
      </dl>
      <p className="text-sm text-muted-foreground">{t('sentBody')}</p>
      {termsAccepted ? (
        <p data-testid="booking-sent-terms" className="flex items-center justify-center gap-1.5 text-sm text-primary"><ShieldCheck className="size-4" aria-hidden />{t('picker.termsAccepted')}</p>
      ) : null}
    </div>
  )
}
