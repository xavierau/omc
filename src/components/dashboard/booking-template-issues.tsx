'use client'

/**
 * BOOK-002 (AC-4): inline errors (save blocked) and warnings (save allowed)
 * for one language of a booking message, from the shared validator.
 */
import { AlertTriangle, CircleAlert } from 'lucide-react'
import { useTranslations } from 'next-intl'
import type { BookingBodyCheck } from '@/domain/services/booking-template-body'
import type { LanguageCode } from '@/domain/value-objects/language'

const TOKEN: Record<string, string> = { missing_date: '{{date}}', missing_time: '{{time}}' }

export function BookingTemplateIssues({ lang, check }: { lang: LanguageCode; check: BookingBodyCheck }) {
  const t = useTranslations('bookingSettings.templates.editor')
  const warningKey = (code: string) => (code === 'low_ratio' ? `warnings.low_ratio_${lang}` : `warnings.${code}`)
  return (
    <>
      {check.errors.length > 0 ? (
        <ul data-testid={`booking-template-editor-${lang}-errors`} role="alert" className="space-y-1 text-xs text-foreground">
          {check.errors.map((e, i) => (
            <li key={`${e.code}-${i}`} className="flex gap-1.5">
              <CircleAlert aria-hidden="true" className="mt-px size-3.5 shrink-0 text-destructive" />
              <span>{t(`errors.${e.code}`, { detail: e.detail ?? '', token: TOKEN[e.code] ?? '' })}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {check.warnings.length > 0 ? (
        <ul data-testid={`booking-template-editor-${lang}-warnings`} className="space-y-1 text-xs text-amber-700 dark:text-amber-400">
          {check.warnings.map((w, i) => (
            <li key={`${w.code}-${i}`} className="flex gap-1.5">
              <AlertTriangle aria-hidden="true" className="mt-px size-3.5 shrink-0" />
              <span>{t(warningKey(w.code), { detail: w.detail ?? '' })}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </>
  )
}
