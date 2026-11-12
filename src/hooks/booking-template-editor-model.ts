/**
 * BOOK-002: the pure parts of the booking message editor — response parsing,
 * placeholder insertion at the cursor and the preview's sample values. No
 * React here, so it is tested directly.
 */
import type { BookingTemplateKind } from '@/domain/value-objects/booking-config'
import { renderBookingTemplateBody, type BookingBodyCheck } from '@/domain/services/booking-template-body'
import type { BookingTemplateStatuses } from '@/domain/services/booking-templates'
import type { BookingTemplateSlotViews } from '@/application/booking/booking-template-statuses'
import type { LanguageCode } from '@/domain/value-objects/language'
import { parseTemplateSlots, parseTemplateStatuses } from './use-booking-availability'

export type TemplateEditOutcome =
  | { kind: 'submitted' | 'already_live' | 'not_sent' | 'reset' | 'forbidden' | 'not_simple' | 'error' }
  | { kind: 'invalid'; errors: BookingBodyCheck['errors'] }

export interface TemplateOverview {
  templates: BookingTemplateStatuses
  slots: BookingTemplateSlotViews
}

function savedOutcome(overview: TemplateOverview, slot: TemplateEditSlot): TemplateEditOutcome {
  if (slot.reset) return { kind: 'reset' }
  const candidate = overview.slots[slot.kind][slot.language].candidate
  if (!candidate) return { kind: 'already_live' }
  return { kind: candidate.status === 'pending' ? 'submitted' : 'not_sent' }
}

export interface TemplateEditSlot {
  kind: BookingTemplateKind
  language: LanguageCode
  reset: boolean
}

export function templateEditResult(
  status: number,
  body: unknown,
  slot: TemplateEditSlot
): { outcome: TemplateEditOutcome; overview: TemplateOverview | null } {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  if (status === 200) {
    const templates = parseTemplateStatuses(b.templates)
    const slots = parseTemplateSlots(b.slots)
    if (templates && slots) return { outcome: savedOutcome({ templates, slots }, slot), overview: { templates, slots } }
  }
  if (status === 400 && Array.isArray(b.errors)) return { outcome: { kind: 'invalid', errors: b.errors }, overview: null }
  if (status === 403) return { outcome: { kind: 'forbidden' }, overview: null }
  if (status === 409) return { outcome: { kind: 'not_simple' }, overview: null }
  return { outcome: { kind: 'error' }, overview: null }
}

/** Puts `{{name}}` over the selection; returns the new text and where the cursor goes. */
export function insertPlaceholder(text: string, start: number, end: number, name: string): { text: string; cursor: number } {
  const token = `{{${name}}}`
  const from = Math.max(0, Math.min(start, text.length))
  const to = Math.max(from, Math.min(end, text.length))
  return { text: `${text.slice(0, from)}${token}${text.slice(to)}`, cursor: from + token.length }
}

/** Sample details for the live preview. */
export const PREVIEW_SAMPLES: Record<LanguageCode, Record<string, string>> = {
  en: { name: 'Chan Tai Man', restaurant: 'Kushiro', date: '2026-11-20', time: '19:30', party_size: '4', reason: 'Fully booked that evening' },
  zh_hk: { name: '陳大文', restaurant: '串燒居', date: '2026-11-20', time: '19:30', party_size: '4', reason: '當晚已經滿座' },
}

/** The preview text: the trimmed draft with sample details filled in (plain text). */
export function previewText(lang: LanguageCode, draft: string): string {
  return renderBookingTemplateBody(draft.trim(), PREVIEW_SAMPLES[lang])
}

const FAILED: ReadonlyArray<TemplateEditOutcome['kind']> = ['not_sent', 'forbidden', 'not_simple', 'error', 'invalid']

export function isFailedOutcome(outcome: TemplateEditOutcome): boolean {
  return FAILED.includes(outcome.kind)
}
