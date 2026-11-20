'use client'

/**
 * BOOK-009 AC-6: the booking terms with a required tick. Both set languages
 * are shown, zh-HK first, as text only (R3): the same text the booking
 * stores as the accepted snapshot (W1 `termsSnapshot`).
 */
import { useTranslations } from 'next-intl'
import { Info } from 'lucide-react'
import { HOURS_LANGUAGES, type BookingHours } from '@/domain/value-objects/booking-hours'

export interface TermsBlockProps {
  terms: BookingHours['terms']
  accepted: boolean
  onChange: (accepted: boolean) => void
  error?: string
}

export function TermsBlock({ terms, accepted, onChange, error }: TermsBlockProps) {
  const t = useTranslations('booking')
  return (
    <section data-testid="booking-terms" className="space-y-3 rounded-xl border border-pending-foreground/30 bg-pending-soft p-4">
      <h2 className="flex items-center gap-1.5 text-base font-semibold text-pending-foreground"><Info className="size-4" aria-hidden />{t('picker.termsTitle')}</h2>
      {HOURS_LANGUAGES.filter((lang) => terms[lang] !== '').map((lang) => (
        <p key={lang} lang={lang === 'zh_hk' ? 'zh-HK' : 'en'} className="text-sm leading-relaxed whitespace-pre-line text-foreground">{terms[lang]}</p>
      ))}
      <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm font-semibold text-foreground">
        <input type="checkbox" checked={accepted} onChange={(e) => onChange(e.target.checked)} data-testid="booking-terms-tick"
          aria-invalid={Boolean(error)} aria-describedby={error ? 'booking-acceptTerms-error' : undefined} className="size-5 accent-primary" />
        {t('picker.termsTick')}
      </label>
      {error ? <p id="booking-acceptTerms-error" data-testid="booking-field-error-acceptTerms" className="text-xs text-destructive">{t(`errors.${error}`)}</p> : null}
    </section>
  )
}
