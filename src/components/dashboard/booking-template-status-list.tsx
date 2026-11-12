'use client'

/**
 * BOOK-001 W3 (AC-1): each booking UTILITY template's status, per language.
 * Until a template is approved, messages outside the diner's 24-hour window
 * are not delivered (staff see the not-delivered badge).
 */
import { useTranslations } from 'next-intl'
import { Badge } from '@/components/ui/badge'
import { TEMPLATE_KINDS, TEMPLATE_LANGUAGES } from '@/domain/value-objects/booking-config'
import type { BookingTemplateStatus, BookingTemplateStatuses } from '@/domain/services/booking-templates'

const VARIANT: Record<BookingTemplateStatus, { variant: 'default' | 'outline' | 'secondary'; className?: string }> = {
  approved: { variant: 'default' },
  pending: { variant: 'outline' },
  rejected: { variant: 'outline', className: 'border-destructive text-foreground' },
  failed: { variant: 'outline', className: 'border-destructive text-foreground' },
  not_submitted: { variant: 'secondary' },
}

export function BookingTemplateStatusList({ statuses }: { statuses: BookingTemplateStatuses | null }) {
  const t = useTranslations('bookingSettings')
  return (
    <div className="space-y-2" data-testid="booking-template-statuses">
      <p className="text-sm font-medium">{t('templates.title')}</p>
      <p className="text-xs text-muted-foreground">{t('templates.hint')}</p>
      {statuses ? (
        <ul className="divide-y rounded-md border text-sm">
          {TEMPLATE_KINDS.map((kind) => (
            <li key={kind} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
              <span>{t(`templates.kind.${kind}`)}</span>
              <span className="flex gap-2">
                {TEMPLATE_LANGUAGES.map((lang) => {
                  const status = statuses[kind][lang]
                  return (
                    <Badge key={lang} variant={VARIANT[status].variant} className={VARIANT[status].className}
                      data-testid={`booking-template-status-${kind}-${lang}`}>
                      {t(`templates.status.${status}`)} · {t(`templates.lang.${lang}`)}
                    </Badge>
                  )
                })}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p data-testid="booking-template-status-unknown" className="text-xs text-muted-foreground">{t('templates.unknown')}</p>
      )}
    </div>
  )
}
