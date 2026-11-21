'use client'

/**
 * BOOK-010 AC-10 (S1 mockup): Confirm on a pending request that would take
 * its slot or meal over the guest limit asks first: "This takes 19:00 to
 * 34 / 30 guests. Confirm anyway?". Limits never block staff: Confirm anyway
 * re-sends the confirm with `confirmAnyway: true`; Cancel changes nothing.
 */
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import type { OverLimit, OverLimitAsk } from '@/hooks/use-bookings'

export interface OverLimitPromptProps {
  overLimit: OverLimit
  busy: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function OverLimitPrompt({ overLimit, busy, onConfirm, onCancel }: OverLimitPromptProps) {
  const t = useTranslations('bookings.capacity')
  const { guests, limit } = overLimit
  const text = overLimit.scope === 'slot'
    ? t('overLimitSlot', { time: overLimit.time, guests, limit })
    : t('overLimitMeal', { period: overLimit.period, guests, limit })
  return (
    <div data-testid="bookings-confirm-over-limit" role="alertdialog" aria-labelledby="bookings-over-limit-title" aria-describedby="bookings-over-limit-text"
      className="space-y-3 border-t border-accent/30 bg-pending-soft px-4 py-4 sm:px-5">
      <h3 id="bookings-over-limit-title" className="font-semibold text-pending-foreground">{t('overLimitTitle')}</h3>
      <p id="bookings-over-limit-text" className="text-sm text-foreground">{text}</p>
      <div className="flex flex-wrap gap-2">
        <Button onClick={onConfirm} disabled={busy} autoFocus data-testid="bookings-confirm-over-limit-confirm">{t('confirmAnyway')}</Button>
        <Button variant="outline" onClick={onCancel} disabled={busy} data-testid="bookings-confirm-over-limit-cancel">{t('cancel')}</Button>
      </div>
    </div>
  )
}

export interface OverLimitRows {
  overLimit: OverLimitAsk | null
  busyIds: ReadonlySet<string>
  confirmAnyway: (id: string) => Promise<void>
  cancelOverLimit: () => void
}

/** The prompt for the row the page is asking about, or nothing. */
export function OverLimitFor({ rows }: { rows: OverLimitRows }) {
  const ask = rows.overLimit
  if (!ask) return null
  return <OverLimitPrompt overLimit={ask.overLimit} busy={rows.busyIds.has(ask.id)} onConfirm={() => void rows.confirmAnyway(ask.id)} onCancel={rows.cancelOverLimit} />
}
