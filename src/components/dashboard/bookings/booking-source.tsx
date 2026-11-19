/** BOOK-004: where a booking came from (WhatsApp chat link, campaign link, AI agent). */
import { useTranslations } from 'next-intl'
import { Bot, Megaphone, MessageCircle } from 'lucide-react'
import type { BookingItem } from '@/hooks/use-bookings'

const ICON = { chat: MessageCircle, campaign: Megaphone, agent: Bot } as const

export function BookingSource({ source }: { source: BookingItem['source'] }) {
  const t = useTranslations('bookings.views.source')
  const Icon = ICON[source]
  return (
    <span className="inline-flex items-center gap-1.5 text-muted-foreground">
      <Icon aria-hidden className="size-3.5 shrink-0" />
      {t(source)}
    </span>
  )
}
