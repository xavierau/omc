'use client'

/** BOOK-009 AC-6: party size as buttons 1…max, then the large-party line (WhatsApp). */
import { useTranslations } from 'next-intl'
import { MessageCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { chipClass } from './chip'

export interface PartyPickerProps {
  max: number
  value: number | null
  onChange: (n: number) => void
  retryUrl: string | null
  error?: string
}

export function PartyPicker({ max, value, onChange, retryUrl, error }: PartyPickerProps) {
  const t = useTranslations('booking')
  return (
    <section className="space-y-2" aria-labelledby="booking-party-title">
      <div className="flex items-baseline justify-between">
        <h2 id="booking-party-title" className="text-base font-semibold text-foreground">{t('partySize')}</h2>
        <span className="text-xs text-muted-foreground">{t('picker.partyRange', { max })}</span>
      </div>
      <div role="radiogroup" aria-labelledby="booking-party-title" className="grid grid-cols-6 gap-2 min-[380px]:grid-cols-8">
        {Array.from({ length: max }, (_, i) => i + 1).map((n) => (
          <button key={n} type="button" role="radio" aria-checked={value === n} onClick={() => onChange(n)} data-testid={`booking-party-${n}`}
            className={cn(chipClass(value === n), 'h-11 text-base')}>
            {n}
          </button>
        ))}
      </div>
      {retryUrl ? (
        <a href={retryUrl} data-testid="booking-large-party" className="inline-flex min-h-6 items-center gap-1.5 text-sm text-primary underline-offset-2 hover:underline">
          <MessageCircle className="size-4" aria-hidden />{t('picker.largeParty', { max })}
        </a>
      ) : (
        <p data-testid="booking-large-party" className="text-sm text-muted-foreground">{t('picker.largeParty', { max })}</p>
      )}
      {error ? <p data-testid="booking-field-error-partySize" className="text-xs text-destructive">{t(`errors.${error}`, { max })}</p> : null}
    </section>
  )
}
