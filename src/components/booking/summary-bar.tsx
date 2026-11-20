'use client'

/**
 * BOOK-009 AC-7: the bar fixed at the bottom of the screen: the choices so far
 * as chips, and the submit button, disabled and labelled with the missing
 * step until party, day, slot and terms are done.
 */
import { useTranslations } from 'next-intl'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { dayLabel } from './booking-date-label'
import type { MissingStep } from './slot-picker-model'
import type { SlotFormValues } from '@/hooks/use-booking-slot-form'

export interface SummaryBarProps {
  values: SlotFormValues
  missing: MissingStep | null
  submitting: boolean
  preview: boolean
}

function Chip({ text, empty }: { text: string; empty?: boolean }) {
  return (
    <span className={cn('rounded-md px-2.5 py-1 text-sm font-semibold tabular-nums', empty ? 'border border-dashed border-border text-muted-foreground' : 'bg-muted text-foreground')}>
      {text}
    </span>
  )
}

export function SummaryBar({ values, missing, submitting, preview }: SummaryBarProps) {
  const t = useTranslations('booking')
  const sep = <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
  const label = submitting ? t('submitting') : missing ? t(`picker.missing.${missing}`) : t('submit')
  return (
    <div data-testid="booking-summary-bar" className="fixed inset-x-0 bottom-0 z-10 border-t border-border bg-card px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      <div className="mx-auto max-w-md space-y-2.5">
        <div className="flex flex-wrap items-center gap-1.5" aria-live="polite">
          <Chip text={values.partySize === null ? t('partySize') : t('picker.partyChip', { n: values.partySize })} empty={values.partySize === null} />
          {sep}
          <Chip text={values.date ? dayLabel(t, values.date) : t('date')} empty={!values.date} />
          {sep}
          <Chip text={values.time || t('picker.timeChip')} empty={!values.time} />
        </div>
        <Button type="submit" disabled={preview || submitting || missing !== null} className="h-12 w-full text-base" data-testid="booking-submit">{label}</Button>
      </div>
    </div>
  )
}
