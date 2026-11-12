/**
 * BOOK-001 AC-12: a link that cannot be used (expired, used, unknown, or
 * booking switched off). No form; one tap re-asks on WhatsApp by sending
 * BOOK, which gives the diner a fresh link (W2).
 */
import { useTranslations } from 'next-intl'

const TITLE_KEY: Record<string, string> = {
  expired: 'expiredTitle',
  consumed: 'consumedTitle',
  unknown: 'unknownTitle',
  off: 'offTitle',
}

export function BookingUnavailable({ reason, retryUrl }: { reason: string; retryUrl: string | null }) {
  const t = useTranslations('booking')
  return (
    <div data-testid="booking-unavailable" data-reason={reason} className="space-y-4 text-center">
      <h2 className="text-lg font-semibold text-foreground">{t(TITLE_KEY[reason] ?? 'unknownTitle')}</h2>
      <p className="text-sm text-muted-foreground">{t('unavailableBody')}</p>
      {retryUrl ? (
        <a
          data-testid="booking-ask-whatsapp"
          href={retryUrl}
          className="inline-flex h-11 w-full items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          {t('askOnWhatsapp')}
        </a>
      ) : (
        <p className="text-sm text-muted-foreground">{t('askOnWhatsappManual')}</p>
      )}
    </div>
  )
}
