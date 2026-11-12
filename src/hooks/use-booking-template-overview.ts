'use client'

/**
 * BOOK-002: what the booking settings section shows about its messages —
 * statuses and the editor's slot views from GET, then replaced by each
 * settings save (statuses) and each message edit (both), whichever is newer —
 * and which message's editor is open.
 */
import { useState } from 'react'
import type { BookingTemplateStatuses } from '@/domain/services/booking-templates'
import type { BookingTemplateKind } from '@/domain/value-objects/booking-config'
import type { BookingSettingsSummary, BookingTemplateEditorAccess } from './use-booking-availability'
import type { SaveBookingSettingsOutcome } from './use-booking-settings'
import type { TemplateOverview } from './booking-template-editor-model'

interface Live {
  templates: BookingTemplateStatuses | null
  editor: BookingTemplateEditorAccess | null
  /** The settings-save outcome these statuses already account for. */
  seen: SaveBookingSettingsOutcome | null
}

export function useBookingTemplateOverview(summary: BookingSettingsSummary | null, outcome: SaveBookingSettingsOutcome | null) {
  const [live, setLive] = useState<Live | null>(null)
  const [editingKind, setEditingKind] = useState<BookingTemplateKind | null>(null)
  const base = live ?? { templates: summary?.templates ?? null, editor: summary?.editor ?? null, seen: null }
  const freshSave = outcome?.kind === 'saved' && outcome !== base.seen && outcome.templates ? outcome : null
  const templates = freshSave ? freshSave.templates : base.templates

  function onSaved(overview: TemplateOverview) {
    setLive({ templates: overview.templates, editor: base.editor && { ...base.editor, slots: overview.slots }, seen: outcome })
  }

  return {
    templates,
    editor: base.editor,
    editingKind,
    toggle: (kind: BookingTemplateKind) => setEditingKind((open) => (open === kind ? null : kind)),
    close: () => setEditingKind(null),
    onSaved,
  }
}
