/**
 * BOOK-002 (AC-2, AC-4, AC-5): an admin changes one booking message's text
 * (kind × language) in Simple mode, or resets it to the default copy.
 *
 * The text is stored, and when it differs from the live approved template it
 * is submitted to Meta as a new UTILITY template under a freshly minted name
 * (the candidate), replacing any older candidate. The approved template keeps
 * sending meanwhile; the sender switches once Meta approves (lazy promotion).
 * When the text already equals the approved body, nothing is submitted and an
 * older candidate is cleared. Validation errors store and submit nothing.
 */
import { bookingTemplateBody, metaLanguageCode, mintBookingTemplateName } from '@/domain/services/booking-templates'
import { validateBookingTemplateBody, type BookingBodyCheck } from '@/domain/services/booking-template-body'
import { approvedBodyOf, resolveBookingTemplateSlot, type BookingTemplateEdit } from '@/domain/services/booking-template-slot'
import type { BookingConfig, BookingTemplateKind } from '@/domain/value-objects/booking-config'
import type { LanguageCode } from '@/domain/value-objects/language'
import type { TemplateCategory, TemplateComponent, WhatsAppTemplate } from '@/domain/entities/whatsapp-template'
import { templateRowsById } from './booking-template-statuses'

export interface EditBookingTemplateInput {
  restaurantId: string
  kind: BookingTemplateKind
  language: LanguageCode
  /** The new text; null = reset to the default copy. */
  body: string | null
}

export type EditBookingTemplateResult =
  | { ok: true; warnings: BookingBodyCheck['warnings'] }
  | { ok: false; reason: 'not_simple' }
  | { ok: false; reason: 'invalid'; errors: BookingBodyCheck['errors'] }

export interface EditBookingTemplateDeps {
  getConfig(restaurantId: string): Promise<BookingConfig>
  findTemplates(ids: string[], restaurantId: string): Promise<WhatsAppTemplate[]>
  createTemplate(params: {
    restaurantId: string
    name: string
    language: string
    category: TemplateCategory
    components: TemplateComponent[]
  }): Promise<{ template: WhatsAppTemplate; error?: string }>
  saveTemplateEdit(restaurantId: string, edit: BookingTemplateEdit): Promise<void>
  /** Short random [a-z0-9] suffix for a per-attempt template name. */
  suffix(): string
}

async function submitCandidate(input: EditBookingTemplateInput, text: string, deps: EditBookingTemplateDeps): Promise<string> {
  const { template } = await deps.createTemplate({
    restaurantId: input.restaurantId,
    name: mintBookingTemplateName(input.kind, deps.suffix()),
    language: metaLanguageCode(input.language),
    category: 'UTILITY',
    components: [{ type: 'BODY', text }],
  })
  return template.id
}

export async function editBookingTemplate(input: EditBookingTemplateInput, deps: EditBookingTemplateDeps): Promise<EditBookingTemplateResult> {
  const config = await deps.getConfig(input.restaurantId)
  if (config.mode !== 'simple') return { ok: false, reason: 'not_simple' }
  const body = input.body === null ? null : input.body.trim()
  const check = body === null ? { errors: [], warnings: [] } : validateBookingTemplateBody(input.kind, input.language, body)
  if (check.errors.length > 0) return { ok: false, reason: 'invalid', errors: check.errors }

  const rows = await templateRowsById(config, input.restaurantId, deps.findTemplates)
  const slot = resolveBookingTemplateSlot(config, input.kind, input.language, rows)
  const target = body ?? bookingTemplateBody(input.kind, input.language)
  const candidateId = approvedBodyOf(slot, rows) === target ? null : await submitCandidate(input, target, deps)
  await deps.saveTemplateEdit(input.restaurantId, {
    kind: input.kind,
    language: input.language,
    body,
    candidateId,
    promotedId: slot.promoted ? slot.currentId : null,
  })
  return { ok: true, warnings: check.warnings }
}
