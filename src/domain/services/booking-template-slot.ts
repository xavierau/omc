/**
 * BOOK-002 (AC-2, AC-3): one booking message slot (kind × language) holds the
 * live template (`templateIds`) and, after an edit, a candidate awaiting Meta
 * (`templateCandidates`). The old approved template keeps sending until the
 * candidate is approved; an approved candidate counts as live everywhere
 * (lazy promotion) and is written into `templateIds` by the next sender or
 * edit that sees it.
 */
import { bookingTemplateStatus } from './booking-templates'
import type { WhatsAppTemplate } from '../entities/whatsapp-template'
import type { BookingConfig, BookingTemplateKind } from '../value-objects/booking-config'
import type { LanguageCode } from '../value-objects/language'

export type BookingCandidateStatus = 'pending' | 'rejected' | 'failed'

export interface BookingTemplateSlot {
  currentId: string | null
  candidateId: string | null
  /** True when an approved candidate was taken as the live template. */
  promoted: boolean
}

/** What an edit writes onto the stored config (read-modify-write). */
export interface BookingTemplateEdit {
  kind: BookingTemplateKind
  language: LanguageCode
  /** The custom text; null = back to the default copy. */
  body: string | null
  candidateId: string | null
  /** Set when an approved candidate was promoted while editing. */
  promotedId: string | null
}

type Rows = Map<string, WhatsAppTemplate>
export type BookingSlotConfig = Pick<BookingConfig, 'templateIds' | 'templateCandidates'>

export function resolveBookingTemplateSlot(config: BookingSlotConfig, kind: BookingTemplateKind, language: LanguageCode, rows: Rows): BookingTemplateSlot {
  const currentId = config.templateIds[kind][language]
  const candidateId = config.templateCandidates[kind][language] ?? null
  const candidate = candidateId ? rows.get(candidateId) : undefined
  if (candidate?.status === 'approved') return { currentId: candidateId, candidateId: null, promoted: true }
  return { currentId, candidateId, promoted: false }
}

/** A candidate's state for the settings page; null when there is none (or its row is gone). */
export function bookingCandidateStatus(row: WhatsAppTemplate | null | undefined): BookingCandidateStatus | null {
  const status = bookingTemplateStatus(row ?? null)
  return status === 'pending' || status === 'rejected' || status === 'failed' ? status : null
}

export function templateBodyText(row: WhatsAppTemplate | null | undefined): string | null {
  return row?.components.find((c) => c.type === 'BODY')?.text ?? null
}

/** The BODY of the live template when Meta approved it; null otherwise. */
export function approvedBodyOf(slot: BookingTemplateSlot, rows: Rows): string | null {
  const row = slot.currentId ? rows.get(slot.currentId) : undefined
  return row?.status === 'approved' ? templateBodyText(row) : null
}

function setText(map: BookingConfig['templateBodies'], edit: { kind: BookingTemplateKind; language: LanguageCode }, value: string | null) {
  if (value === null) delete map[edit.kind][edit.language]
  else map[edit.kind][edit.language] = value
}

export function applyBookingTemplateEdit(config: BookingConfig, edit: BookingTemplateEdit): BookingConfig {
  const next = structuredClone(config)
  setText(next.templateBodies, edit, edit.body)
  setText(next.templateCandidates, edit, edit.candidateId)
  if (edit.promotedId) next.templateIds[edit.kind][edit.language] = edit.promotedId
  return next
}

/** Moves the candidate into the live slot; null when the stored candidate is no longer this id. */
export function applyBookingTemplatePromotion(
  config: BookingConfig,
  slot: { kind: BookingTemplateKind; language: LanguageCode },
  candidateId: string
): BookingConfig | null {
  if (config.templateCandidates[slot.kind][slot.language] !== candidateId) return null
  const next = structuredClone(config)
  next.templateIds[slot.kind][slot.language] = candidateId
  delete next.templateCandidates[slot.kind][slot.language]
  return next
}
