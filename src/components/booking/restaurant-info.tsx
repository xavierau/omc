/**
 * BOOK-009 S1.8 / AC-6: the restaurant's address, tap-to-call phone and map
 * link, when set. Text only (R3); the map link is the admin's https URL.
 */
import { useTranslations } from 'next-intl'
import { Map as MapIcon, MapPin, Phone } from 'lucide-react'
import type { BookingHours } from '@/domain/value-objects/booking-hours'

const telHref = (phone: string) => `tel:${phone.replace(/[^\d+]/g, '')}`
const link = 'inline-flex min-h-6 items-center gap-1.5 text-primary underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-ring'

export function RestaurantInfo({ info }: { info: BookingHours['info'] }) {
  const t = useTranslations('booking.picker')
  if (!info.address && !info.phone && !info.mapUrl) return null
  return (
    <section data-testid="booking-restaurant-info" className="space-y-2 rounded-xl border border-border p-3 text-sm">
      {info.address ? (
        <p className="flex items-start gap-2 text-foreground"><MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />{info.address}</p>
      ) : null}
      {info.phone || info.mapUrl ? (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          {info.phone ? (
            <a href={telHref(info.phone)} aria-label={t('callLabel', { phone: info.phone })} className={link}>
              <Phone className="size-4 text-muted-foreground" aria-hidden />{info.phone}
            </a>
          ) : null}
          {info.mapUrl ? (
            <a href={info.mapUrl} target="_blank" rel="noopener noreferrer" className={link}>
              <MapIcon className="size-4 text-muted-foreground" aria-hidden />{t('viewMap')}
            </a>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
