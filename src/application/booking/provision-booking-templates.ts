/**
 * BOOK-001 W3 (AC-1 templates): submit the restaurant's booking UTILITY
 * templates (4 kinds × zh_HK/en) through the normal create-template path and
 * store their ids in booking_config.templateIds.
 *
 * Idempotent per (kind, language): a template that is pending or approved is
 * kept; a rejected, failed (never reached Meta) or missing one is submitted
 * again under a freshly minted name, since a name is unique per WABA forever
 * (memory: principle_whatsapp_flow_naming_and_waba_scope). Never throws for a
 * single failed submission: that template reads `not_submitted`/`failed` and
 * the next save retries it. Settings are saved before this runs.
 */
import {
  BOOKING_TEMPLATE_LANGUAGES,
  bookingTemplateComponents,
  bookingTemplateStatus,
  metaLanguageCode,
  mintBookingTemplateName,
  needsSubmission,
  type BookingTemplateStatuses,
} from '@/domain/services/booking-templates'
import { TEMPLATE_KINDS, type BookingConfig, type BookingTemplateKind } from '@/domain/value-objects/booking-config'
import type { LanguageCode } from '@/domain/value-objects/language'
import type { TemplateCategory, TemplateComponent, WhatsAppTemplate } from '@/domain/entities/whatsapp-template'
import { templateRowsById, statusesOf } from './booking-template-statuses'

type TemplateIds = BookingConfig['templateIds']

export interface ProvisionBookingTemplatesDeps {
  getConfig(restaurantId: string): Promise<BookingConfig>
  findTemplates(ids: string[], restaurantId: string): Promise<WhatsAppTemplate[]>
  createTemplate(params: {
    restaurantId: string
    name: string
    language: string
    category: TemplateCategory
    components: TemplateComponent[]
  }): Promise<{ template: WhatsAppTemplate; error?: string }>
  saveTemplateIds(restaurantId: string, ids: TemplateIds): Promise<void>
  /** Short random [a-z0-9] suffix for a per-attempt template name. */
  suffix(): string
}

interface Submission {
  kind: BookingTemplateKind
  language: LanguageCode
  name: string
}

function pendingSubmissions(ids: TemplateIds, rows: Map<string, WhatsAppTemplate>, deps: ProvisionBookingTemplatesDeps): Submission[] {
  return TEMPLATE_KINDS.flatMap((kind) => {
    const languages = BOOKING_TEMPLATE_LANGUAGES.filter((lang) => {
      const id = ids[kind][lang]
      return needsSubmission(bookingTemplateStatus(id ? rows.get(id) ?? null : null))
    })
    if (languages.length === 0) return []
    const name = mintBookingTemplateName(kind, deps.suffix())
    return languages.map((language) => ({ kind, language, name }))
  })
}

async function submit(restaurantId: string, s: Submission, deps: ProvisionBookingTemplatesDeps) {
  try {
    const { template } = await deps.createTemplate({
      restaurantId,
      name: s.name,
      language: metaLanguageCode(s.language),
      category: 'UTILITY',
      components: bookingTemplateComponents(s.kind, s.language),
    })
    return template
  } catch (err) {
    console.warn('[Booking] template submission failed:', { kind: s.kind, language: s.language, error: (err as Error).message })
    return null
  }
}

export async function provisionBookingTemplates(
  restaurantId: string,
  deps: ProvisionBookingTemplatesDeps
): Promise<BookingTemplateStatuses> {
  const config = await deps.getConfig(restaurantId)
  const rows = await templateRowsById(config.templateIds, restaurantId, deps.findTemplates)
  const submissions = pendingSubmissions(config.templateIds, rows, deps)
  if (submissions.length === 0) return statusesOf(config.templateIds, rows)

  const ids: TemplateIds = structuredClone(config.templateIds)
  const created = await Promise.all(submissions.map((s) => submit(restaurantId, s, deps)))
  submissions.forEach((s, i) => {
    const template = created[i]
    ids[s.kind][s.language] = template?.id ?? null
    if (template) rows.set(template.id, template)
  })
  await deps.saveTemplateIds(restaurantId, ids)
  return statusesOf(ids, rows)
}
