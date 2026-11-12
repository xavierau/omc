/**
 * BOOK-001 W3: each booking template's status (pending / approved / rejected /
 * failed / not submitted), read from the restaurant's own whatsapp_templates
 * rows. The lookup is scoped to the restaurant.
 *
 * BOOK-002: rows include each slot's candidate (an edit awaiting Meta). An
 * approved candidate is shown as the live template (lazy promotion), and the
 * slot views carry what the message editor needs. F1: the statuses alone skip
 * the slot views (C10), and a view carries the approved live text the editor
 * opens with (C6).
 */
import {
  BOOKING_TEMPLATE_LANGUAGES,
  bookingTemplateBody,
  bookingTemplateStatus,
  type BookingTemplateStatus,
  type BookingTemplateStatuses,
} from '@/domain/services/booking-templates'
import {
  approvedBodyOf,
  bookingCandidateStatus,
  resolveBookingTemplateSlot,
  type BookingCandidateStatus,
  type BookingSlotConfig,
} from '@/domain/services/booking-template-slot'
import { allowedBookingPlaceholders } from '@/domain/services/booking-template-body'
import { TEMPLATE_KINDS, type BookingConfig, type BookingTemplateKind } from '@/domain/value-objects/booking-config'
import type { LanguageCode } from '@/domain/value-objects/language'
import type { WhatsAppTemplate } from '@/domain/entities/whatsapp-template'

type FindTemplates = (ids: string[], restaurantId: string) => Promise<WhatsAppTemplate[]>
type Rows = Map<string, WhatsAppTemplate>

export interface BookingTemplateSlotView {
  status: BookingTemplateStatus
  candidate: { status: BookingCandidateStatus; reason: string | null } | null
  customBody: string | null
  /** The live template's text when Meta approved it; null otherwise. */
  approvedBody: string | null
  defaultBody: string
  placeholders: string[]
}

export type BookingTemplateSlotViews = Record<BookingTemplateKind, Record<LanguageCode, BookingTemplateSlotView>>

export interface BookingTemplateOverview {
  templates: BookingTemplateStatuses
  slots: BookingTemplateSlotViews
}

export async function templateRowsById(config: BookingSlotConfig, restaurantId: string, findTemplates: FindTemplates): Promise<Rows> {
  const wanted = TEMPLATE_KINDS.flatMap((kind) => [
    ...Object.values(config.templateIds[kind]),
    ...Object.values(config.templateCandidates[kind]),
  ]).filter((id): id is string => !!id)
  if (wanted.length === 0) return new Map()
  const rows = await findTemplates(wanted, restaurantId)
  return new Map(rows.map((t) => [t.id, t]))
}

function byKindAndLanguage<T>(build: (kind: BookingTemplateKind, lang: LanguageCode) => T): Record<BookingTemplateKind, Record<LanguageCode, T>> {
  const entries = TEMPLATE_KINDS.map((kind) => {
    const byLang = BOOKING_TEMPLATE_LANGUAGES.map((lang) => [lang, build(kind, lang)] as const)
    return [kind, Object.fromEntries(byLang)] as const
  })
  return Object.fromEntries(entries) as Record<BookingTemplateKind, Record<LanguageCode, T>>
}

function liveStatus(config: BookingSlotConfig, rows: Rows, kind: BookingTemplateKind, lang: LanguageCode): BookingTemplateStatus {
  const slot = resolveBookingTemplateSlot(config, kind, lang, rows)
  return bookingTemplateStatus(slot.currentId ? rows.get(slot.currentId) ?? null : null)
}

export function statusesOf(config: BookingSlotConfig, rows: Rows): BookingTemplateStatuses {
  return byKindAndLanguage((kind, lang) => liveStatus(config, rows, kind, lang))
}

function slotView(config: BookingConfig, rows: Rows, kind: BookingTemplateKind, lang: LanguageCode): BookingTemplateSlotView {
  const slot = resolveBookingTemplateSlot(config, kind, lang, rows)
  const candidateRow = slot.candidateId ? rows.get(slot.candidateId) : undefined
  const candidateStatus = bookingCandidateStatus(candidateRow)
  return {
    status: liveStatus(config, rows, kind, lang),
    candidate: candidateStatus ? { status: candidateStatus, reason: candidateRow?.rejectionReason ?? null } : null,
    customBody: config.templateBodies[kind][lang] ?? null,
    approvedBody: approvedBodyOf(slot, rows),
    defaultBody: bookingTemplateBody(kind, lang),
    placeholders: allowedBookingPlaceholders(kind),
  }
}

export function overviewOf(config: BookingConfig, rows: Rows): BookingTemplateOverview {
  return { templates: statusesOf(config, rows), slots: byKindAndLanguage((kind, lang) => slotView(config, rows, kind, lang)) }
}

interface ReadDeps {
  getConfig(restaurantId: string): Promise<BookingConfig>
  findTemplates: FindTemplates
}

/** `config` = one the caller already read (the settings GET), else it is read here. */
export async function bookingTemplateOverview(restaurantId: string, deps: ReadDeps, config?: BookingConfig): Promise<BookingTemplateOverview> {
  const current = config ?? (await deps.getConfig(restaurantId))
  return overviewOf(current, await templateRowsById(current, restaurantId, deps.findTemplates))
}

export async function bookingTemplateStatuses(restaurantId: string, deps: ReadDeps): Promise<BookingTemplateStatuses> {
  const config = await deps.getConfig(restaurantId)
  return statusesOf(config, await templateRowsById(config, restaurantId, deps.findTemplates))
}
