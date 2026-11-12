/**
 * BOOK-001 W3 (AC-1 templates): submit the restaurant's booking UTILITY
 * templates (4 kinds × zh_HK/en) through the normal create-template path and
 * store their ids in booking_config.templateIds.
 *
 * Idempotent per (kind, language): a template that is pending or approved is
 * kept; a rejected or missing one is submitted again under a freshly minted
 * name, since a name is unique per WABA forever (memory:
 * principle_whatsapp_flow_naming_and_waba_scope). A failed one (a stored draft
 * that never reached Meta) is resubmitted in place, so a provider outage does
 * not leave a new draft row per save (F12, review S-5). Before any submission
 * the WABA id is resolved and stored once, so a draft stored before the WABA
 * was known reaches Meta on a later save (F2, re-review N-1). Never throws for a
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
  /** Resubmits an existing draft row (same id, same name) with these components. */
  resubmitTemplate(
    id: string,
    restaurantId: string,
    components: TemplateComponent[]
  ): Promise<{ template: WhatsAppTemplate; error?: string }>
  saveTemplateIds(restaurantId: string, ids: TemplateIds): Promise<void>
  /** The stored WABA id, else derived from the linked number and stored; null when unknown. */
  ensureWabaId(restaurantId: string): Promise<string | null>
  /** Short random [a-z0-9] suffix for a per-attempt template name. */
  suffix(): string
}

interface Submission {
  kind: BookingTemplateKind
  language: LanguageCode
  name: string
  /** The failed draft to resubmit in place; null = create a new row. */
  draftId: string | null
}

function pendingSubmissions(ids: TemplateIds, rows: Map<string, WhatsAppTemplate>, deps: ProvisionBookingTemplatesDeps): Submission[] {
  return TEMPLATE_KINDS.flatMap((kind) => {
    const due = BOOKING_TEMPLATE_LANGUAGES.flatMap((language) => {
      const id = ids[kind][language]
      const status = bookingTemplateStatus(id ? rows.get(id) ?? null : null)
      return needsSubmission(status) ? [{ language, draftId: status === 'failed' ? id : null }] : []
    })
    if (due.length === 0) return []
    const name = mintBookingTemplateName(kind, deps.suffix())
    return due.map((d) => ({ kind, name, ...d }))
  })
}

function send(restaurantId: string, s: Submission, deps: ProvisionBookingTemplatesDeps) {
  const components = bookingTemplateComponents(s.kind, s.language)
  if (s.draftId) return deps.resubmitTemplate(s.draftId, restaurantId, components)
  return deps.createTemplate({ restaurantId, name: s.name, language: metaLanguageCode(s.language), category: 'UTILITY', components })
}

// The in-place resubmit (update path) does not resolve the WABA itself, so it
// is resolved here first. A failure leaves the WABA unknown: drafts stay failed.
async function resolveWaba(restaurantId: string, deps: ProvisionBookingTemplatesDeps): Promise<void> {
  try {
    await deps.ensureWabaId(restaurantId)
  } catch (err) {
    console.warn('[Booking] WABA resolution failed:', { error: (err as Error).message })
  }
}

async function submit(restaurantId: string, s: Submission, deps: ProvisionBookingTemplatesDeps) {
  try {
    const { template } = await send(restaurantId, s, deps)
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

  await resolveWaba(restaurantId, deps)
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
