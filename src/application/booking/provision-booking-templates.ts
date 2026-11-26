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
 *
 * BOOK-002: a kind is submitted with the restaurant's custom body when one is
 * set, else the default copy. A slot's approved candidate counts as its live
 * template, and a slot whose edit is still pending at Meta is left alone (the
 * candidate already carries the custom body). F1: only the submitted slots are
 * written (onto the stored config, C2), and a slot that gets a new live
 * template loses its rejected or failed edit (C7).
 */
import {
  BOOKING_TEMPLATE_LANGUAGES,
  bookingKindComponents,
  bookingTemplateBody,
  bookingTemplateStatus,
  hasImageHeader,
  kindHasQrHeader,
  metaLanguageCode,
  mintBookingTemplateName,
  needsSubmission,
  type BookingTemplateStatuses,
} from '@/domain/services/booking-templates'
import { TEMPLATE_KINDS, type BookingConfig, type BookingTemplateKind } from '@/domain/value-objects/booking-config'
import type { LanguageCode } from '@/domain/value-objects/language'
import type { TemplateCategory, TemplateComponent, WhatsAppTemplate } from '@/domain/entities/whatsapp-template'
import {
  applyProvisionedTemplates,
  bookingCandidateStatus,
  resolveBookingTemplateSlot,
  type ProvisionedSlot,
} from '@/domain/services/booking-template-slot'
import { templateRowsById, statusesOf } from './booking-template-statuses'

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
  /** Writes only these slots onto the stored config. */
  saveProvisioned(restaurantId: string, slots: ProvisionedSlot[]): Promise<void>
  /** The stored WABA id, else derived from the linked number and stored; null when unknown. */
  ensureWabaId(restaurantId: string): Promise<string | null>
  /** Short random [a-z0-9] suffix for a per-attempt template name. */
  suffix(): string
  /**
   * BOOK-013: a public sample QR image for the `confirmed` IMAGE header's
   * example (minted into a Meta handle at submit); null when it cannot be
   * made. Without it no `confirmed` is submitted (retried on the next save).
   */
  qrExampleUrl?(): Promise<string | null>
}

interface Submission {
  kind: BookingTemplateKind
  language: LanguageCode
  name: string
  text: string
  /** The failed draft to resubmit in place; null = create a new row. */
  draftId: string | null
  /** The slot's rejected or failed edit, replaced by this submission. */
  staleCandidateId: string | null
  /** BOOK-013 (AC-18): the QR version of a live confirmed without one, stored as the candidate. */
  asCandidate?: { body: string | null }
}

type Rows = Map<string, WhatsAppTemplate>

function slotDue(config: BookingConfig, rows: Rows, kind: BookingTemplateKind, language: LanguageCode) {
  const slot = resolveBookingTemplateSlot(config, kind, language, rows)
  const candidate = bookingCandidateStatus(slot.candidateId ? rows.get(slot.candidateId) : null)
  if (candidate === 'pending') return []
  const status = bookingTemplateStatus(slot.currentId ? rows.get(slot.currentId) ?? null : null)
  if (!needsSubmission(status)) return []
  const text = config.templateBodies[kind][language] ?? bookingTemplateBody(kind, language)
  const staleCandidateId = candidate ? slot.candidateId : null
  return [{ language, text, draftId: status === 'failed' ? slot.currentId : null, staleCandidateId }]
}

/** BOOK-013: the code sentence added to a restaurant's own confirmation text that has none. */
const CODE_LINE: Record<LanguageCode, string> = {
  en: ' Check-in code: {{code}}.',
  zh_hk: '入座編號:{{code}}。',
}

function withCode(text: string, language: LanguageCode): string {
  return text.includes('{{code}}') ? text : `${text}${CODE_LINE[language]}`
}

/**
 * BOOK-013 (AC-18): a live (approved or pending) `confirmed` without the QR
 * header gets its QR version submitted as the slot's candidate, unless one is
 * already waiting at Meta. Custom text keeps its words plus the code line.
 */
function qrUpgradeDue(config: BookingConfig, rows: Rows, language: LanguageCode) {
  const slot = resolveBookingTemplateSlot(config, 'confirmed', language, rows)
  const live = slot.currentId ? rows.get(slot.currentId) : undefined
  const liveStatus = bookingTemplateStatus(live ?? null)
  if (!live || needsSubmission(liveStatus) || hasImageHeader(live)) return []
  const candidate = slot.candidateId ? rows.get(slot.candidateId) : undefined
  if (bookingCandidateStatus(candidate) === 'pending' && hasImageHeader(candidate)) return []
  const custom = config.templateBodies.confirmed[language] ?? null
  const text = custom ? withCode(custom, language) : bookingTemplateBody('confirmed', language)
  return [{ language, text, draftId: null, staleCandidateId: null, asCandidate: { body: custom ? text : null } }]
}

function pendingSubmissions(config: BookingConfig, rows: Rows, deps: ProvisionBookingTemplatesDeps): Submission[] {
  const regular = TEMPLATE_KINDS.flatMap((kind) => {
    const due = BOOKING_TEMPLATE_LANGUAGES.flatMap((language) => slotDue(config, rows, kind, language))
    if (due.length === 0) return []
    const name = mintBookingTemplateName(kind, deps.suffix())
    return due.map((d) => ({ kind, name, ...d }))
  })
  const upgrades = BOOKING_TEMPLATE_LANGUAGES.flatMap((language) => qrUpgradeDue(config, rows, language))
  if (upgrades.length === 0) return regular
  const name = mintBookingTemplateName('confirmed', deps.suffix())
  return [...regular, ...upgrades.map((u) => ({ kind: 'confirmed' as const, name, ...u }))]
}

/** BOOK-013: a `confirmed` submission needs the sample QR; without it, it waits for the next save. */
async function withQrExample(submissions: Submission[], deps: ProvisionBookingTemplatesDeps) {
  if (!submissions.some((s) => kindHasQrHeader(s.kind))) return { submissions, exampleUrl: null }
  const exampleUrl = (await deps.qrExampleUrl?.().catch(() => null)) ?? null
  return { submissions: exampleUrl ? submissions : submissions.filter((s) => !kindHasQrHeader(s.kind)), exampleUrl }
}

function send(restaurantId: string, s: Submission, deps: ProvisionBookingTemplatesDeps, exampleUrl: string | null) {
  const components = bookingKindComponents(s.kind, s.text, exampleUrl)
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

async function submit(restaurantId: string, s: Submission, deps: ProvisionBookingTemplatesDeps, exampleUrl: string | null) {
  try {
    const { template } = await send(restaurantId, s, deps, exampleUrl)
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
  const rows = await templateRowsById(config, restaurantId, deps.findTemplates)
  const { submissions, exampleUrl } = await withQrExample(pendingSubmissions(config, rows, deps), deps)
  if (submissions.length === 0) return statusesOf(config, rows)

  await resolveWaba(restaurantId, deps)
  const created = await Promise.all(submissions.map((s) => submit(restaurantId, s, deps, exampleUrl)))
  const slots: ProvisionedSlot[] = submissions.map((s, i) => {
    const template = created[i]
    if (template) rows.set(template.id, template)
    const base = { kind: s.kind, language: s.language, id: template?.id ?? null, staleCandidateId: s.staleCandidateId }
    return s.asCandidate ? { ...base, asCandidate: s.asCandidate } : base
  })
  await deps.saveProvisioned(restaurantId, slots)
  return statusesOf(applyProvisionedTemplates(config, slots), rows)
}
