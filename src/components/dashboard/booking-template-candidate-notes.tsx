'use client'

/**
 * BOOK-002 (AC-2, AC-3): per language, the state of a submitted edit — a
 * badge (edit pending / rejected / not sent), Meta's rejection reason, and
 * whether the previous approved version is still the one being sent.
 */
import { useTranslations } from 'next-intl'
import { Badge } from '@/components/ui/badge'
import { TEMPLATE_LANGUAGES, type BookingTemplateKind } from '@/domain/value-objects/booking-config'
import type { BookingTemplateSlotViews } from '@/application/booking/booking-template-statuses'
import type { LanguageCode } from '@/domain/value-objects/language'

const BADGE_CLASS = { pending: undefined, rejected: 'border-destructive text-foreground', failed: 'border-destructive text-foreground' }

export function BookingTemplateCandidateBadges({ kind, slots }: { kind: BookingTemplateKind; slots: BookingTemplateSlotViews }) {
  const t = useTranslations('bookingSettings.templates')
  return TEMPLATE_LANGUAGES.map((lang) => {
    const candidate = slots[kind][lang].candidate
    if (!candidate) return null
    return (
      <Badge key={lang} variant="outline" className={BADGE_CLASS[candidate.status]} data-testid={`booking-template-editor-candidate-${kind}-${lang}`}>
        {t(`editor.candidate.${candidate.status}`)} · {t(`lang.${lang}`)}
      </Badge>
    )
  })
}

function Note({ kind, lang, slots }: { kind: BookingTemplateKind; lang: LanguageCode; slots: BookingTemplateSlotViews }) {
  const t = useTranslations('bookingSettings.templates')
  const { candidate, status } = slots[kind][lang]
  if (!candidate) return null
  const language = t(`lang.${lang}`)
  const reason = candidate.reason ?? t('editor.candidate.noReason')
  return (
    <li data-testid={`booking-template-editor-candidate-note-${kind}-${lang}`}>
      {t(`editor.candidate.${candidate.status}Note`, { language, reason })}
      {status === 'approved' ? ` ${t('editor.candidate.oldInUse')}` : null}
    </li>
  )
}

export function BookingTemplateCandidateNotes({ kind, slots }: { kind: BookingTemplateKind; slots: BookingTemplateSlotViews }) {
  if (TEMPLATE_LANGUAGES.every((lang) => !slots[kind][lang].candidate)) return null
  return (
    <ul className="w-full space-y-0.5 text-pretty text-xs text-muted-foreground">
      {TEMPLATE_LANGUAGES.map((lang) => <Note key={lang} kind={kind} lang={lang} slots={slots} />)}
    </ul>
  )
}
