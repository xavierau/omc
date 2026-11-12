/**
 * BOOK-001 W3: each booking template's status (pending / approved / rejected /
 * failed / not submitted), read from the restaurant's own whatsapp_templates
 * rows. The lookup is scoped to the restaurant.
 */
import {
  BOOKING_TEMPLATE_LANGUAGES,
  bookingTemplateStatus,
  type BookingTemplateStatuses,
} from '@/domain/services/booking-templates'
import { TEMPLATE_KINDS, type BookingConfig } from '@/domain/value-objects/booking-config'
import type { WhatsAppTemplate } from '@/domain/entities/whatsapp-template'

type TemplateIds = BookingConfig['templateIds']
type FindTemplates = (ids: string[], restaurantId: string) => Promise<WhatsAppTemplate[]>

export async function templateRowsById(
  ids: TemplateIds,
  restaurantId: string,
  findTemplates: FindTemplates
): Promise<Map<string, WhatsAppTemplate>> {
  const wanted = TEMPLATE_KINDS.flatMap((kind) => Object.values(ids[kind])).filter((id): id is string => !!id)
  if (wanted.length === 0) return new Map()
  const rows = await findTemplates(wanted, restaurantId)
  return new Map(rows.map((t) => [t.id, t]))
}

export function statusesOf(ids: TemplateIds, rows: Map<string, WhatsAppTemplate>): BookingTemplateStatuses {
  const entries = TEMPLATE_KINDS.map((kind) => {
    const byLang = BOOKING_TEMPLATE_LANGUAGES.map((lang) => {
      const id = ids[kind][lang]
      return [lang, bookingTemplateStatus(id ? rows.get(id) ?? null : null)] as const
    })
    return [kind, Object.fromEntries(byLang)] as const
  })
  return Object.fromEntries(entries) as BookingTemplateStatuses
}

export async function bookingTemplateStatuses(
  restaurantId: string,
  deps: { getConfig(restaurantId: string): Promise<BookingConfig>; findTemplates: FindTemplates }
): Promise<BookingTemplateStatuses> {
  const config = await deps.getConfig(restaurantId)
  return statusesOf(config.templateIds, await templateRowsById(config.templateIds, restaurantId, deps.findTemplates))
}
