'use client'

/**
 * BOOK-009 S1.7–S1.8: booking terms per language (≤ 1,000 characters, with a
 * counter) and the restaurant info shown at the top of the booking page.
 */
import { useTranslations } from 'next-intl'
import { MapPin, Phone, Link2 } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { ADDRESS_MAX_CHARS, HOURS_LANGUAGES, PHONE_MAX_CHARS, TERMS_MAX_CHARS, charLength, type BookingHours } from '@/domain/value-objects/booking-hours'
import { fieldError } from './hours-errors'
import { hoursErrorText } from './hours-error-text'
import { HoursFieldError } from './block'
import type { HoursEditProps } from './weekly-hours-table'

export function TermsFields({ hours, errors, onEdit }: HoursEditProps) {
  const t = useTranslations('bookingSettings.bookingHours')
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {HOURS_LANGUAGES.map((lang) => {
        const code = fieldError(errors, `terms.${lang}`)
        return (
          <div key={lang} className="space-y-1.5">
            <label htmlFor={`booking-settings-terms-${lang}`} className="text-sm font-medium">{t(`termsLang.${lang}`)}</label>
            <textarea id={`booking-settings-terms-${lang}`} rows={5} lang={lang === 'zh_hk' ? 'zh-HK' : 'en'} value={hours.terms[lang]}
              aria-invalid={Boolean(code)} data-testid={`booking-settings-terms-${lang}`}
              onChange={(e) => onEdit((h) => ({ ...h, terms: { ...h.terms, [lang]: e.target.value } }))}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm leading-relaxed outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive" />
            <p data-testid={`booking-settings-terms-${lang}-count`} className="text-xs tabular-nums text-muted-foreground">
              {t('counter', { count: charLength(hours.terms[lang]), max: TERMS_MAX_CHARS })}
            </p>
            <HoursFieldError message={code ? hoursErrorText(t, code) : null} testId={`booking-settings-terms-${lang}-error`} />
          </div>
        )
      })}
    </div>
  )
}

type InfoKey = keyof BookingHours['info']
const INFO: { key: InfoKey; testId: string; errorId: string; icon: typeof MapPin; max: number; type: string }[] = [
  { key: 'address', testId: 'address', errorId: 'booking-settings-info-address-error', icon: MapPin, max: ADDRESS_MAX_CHARS, type: 'text' },
  { key: 'phone', testId: 'phone', errorId: 'booking-settings-info-phone-error', icon: Phone, max: PHONE_MAX_CHARS, type: 'tel' },
  { key: 'mapUrl', testId: 'map', errorId: 'booking-settings-map-error', icon: Link2, max: 2048, type: 'url' },
]

export function InfoFields({ hours, errors, onEdit }: HoursEditProps) {
  const t = useTranslations('bookingSettings.bookingHours')
  return (
    <div className="grid gap-4 sm:grid-cols-[2fr_1fr_2fr]">
      {INFO.map(({ key, testId, errorId, icon: Icon, max, type }) => {
        const code = fieldError(errors, `info.${key}`)
        return (
          <div key={key} className="space-y-1.5">
            <label htmlFor={`booking-settings-info-${testId}`} className="text-sm font-medium">{t(key)}</label>
            <div className="relative">
              <Icon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input id={`booking-settings-info-${testId}`} type={type} maxLength={max} value={hours.info[key]} aria-invalid={Boolean(code)}
                placeholder={key === 'mapUrl' ? 'https://' : undefined} data-testid={`booking-settings-info-${testId}`} className="pl-8"
                onChange={(e) => onEdit((h) => ({ ...h, info: { ...h.info, [key]: e.target.value } }))} />
            </div>
            <HoursFieldError message={code ? hoursErrorText(t, code) : null} testId={errorId} />
          </div>
        )
      })}
    </div>
  )
}
