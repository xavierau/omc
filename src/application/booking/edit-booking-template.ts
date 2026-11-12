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
 *
 * F1: the text is validated, compared and stored as the pipeline submits it
 * (full-width braces ASCII-ised, C1). Text equal to the candidate still
 * pending at Meta submits nothing and keeps it (C3). Text equal to the live
 * approved one, with no custom text set, stores nothing (C6).
 */
import {
  bookingTemplateBody,
  bookingTemplateComponents,
  metaLanguageCode,
  mintBookingTemplateName,
} from '@/domain/services/booking-templates'
import {
  normalizeBookingTemplateBody,
  validateBookingTemplateBody,
  type BookingBodyCheck,
} from '@/domain/services/booking-template-body'
import {
  approvedBodyOf,
  bookingCandidateStatus,
  resolveBookingTemplateSlot,
  templateBodyText,
  type BookingTemplateEdit,
  type BookingTemplateSlot,
} from '@/domain/services/booking-template-slot'
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
    components: bookingTemplateComponents(text),
  })
  return template.id
}

type Rows = Map<string, WhatsAppTemplate>

/** F1 C3: the slot's candidate still waiting at Meta with exactly this text. */
function pendingCandidateWith(slot: BookingTemplateSlot, rows: Rows, text: string): string | null {
  const row = slot.candidateId ? rows.get(slot.candidateId) : undefined
  return bookingCandidateStatus(row) === 'pending' && templateBodyText(row) === text ? slot.candidateId : null
}

// F1 C6: text equal to what is live keeps "no custom text" as it was.
function bodyForLiveText(body: string | null, stored: string | null): string | null {
  return body === null || stored === null ? null : body
}

async function planEdit(input: EditBookingTemplateInput, body: string | null, config: BookingConfig, rows: Rows, deps: EditBookingTemplateDeps): Promise<BookingTemplateEdit> {
  const slot = resolveBookingTemplateSlot(config, input.kind, input.language, rows)
  const target = body ?? bookingTemplateBody(input.kind, input.language)
  const base = { kind: input.kind, language: input.language, body, promotedId: slot.promoted ? slot.currentId : null }
  const stored = config.templateBodies[input.kind][input.language] ?? null
  if (approvedBodyOf(slot, rows) === target) return { ...base, body: bodyForLiveText(body, stored), candidateId: null }
  const candidateId = pendingCandidateWith(slot, rows, target) ?? (await submitCandidate(input, target, deps))
  return { ...base, candidateId }
}

/** Nothing to write: same text, same candidate, nothing promoted. */
function changesNothing(config: BookingConfig, edit: BookingTemplateEdit): boolean {
  const stored = config.templateBodies[edit.kind][edit.language] ?? null
  const candidate = config.templateCandidates[edit.kind][edit.language] ?? null
  return edit.promotedId === null && stored === edit.body && candidate === edit.candidateId
}

export async function editBookingTemplate(input: EditBookingTemplateInput, deps: EditBookingTemplateDeps): Promise<EditBookingTemplateResult> {
  const config = await deps.getConfig(input.restaurantId)
  if (config.mode !== 'simple') return { ok: false, reason: 'not_simple' }
  const body = input.body === null ? null : normalizeBookingTemplateBody(input.body)
  const check = body === null ? { errors: [], warnings: [] } : validateBookingTemplateBody(input.kind, input.language, body)
  if (check.errors.length > 0) return { ok: false, reason: 'invalid', errors: check.errors }

  const rows = await templateRowsById(config, input.restaurantId, deps.findTemplates)
  const edit = await planEdit(input, body, config, rows, deps)
  if (!changesNothing(config, edit)) await deps.saveTemplateEdit(input.restaurantId, edit)
  return { ok: true, warnings: check.warnings }
}
