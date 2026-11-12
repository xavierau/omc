'use client'

/**
 * BOOK-002 (AC-1, AC-2, AC-4, AC-5): state for one booking message's editor —
 * a draft per language, its live check (the same validator the API uses),
 * and Save / Reset to default per language. Saving sends the draft as typed;
 * the server trims and re-validates it.
 */
import { useMemo, useRef, useState } from 'react'
import { TEMPLATE_LANGUAGES, type BookingTemplateKind } from '@/domain/value-objects/booking-config'
import { validateBookingTemplateBody, type BookingBodyCheck } from '@/domain/services/booking-template-body'
import type { BookingTemplateSlotViews } from '@/application/booking/booking-template-statuses'
import type { LanguageCode } from '@/domain/value-objects/language'
import { insertPlaceholder, templateEditResult, type TemplateEditOutcome, type TemplateOverview } from './booking-template-editor-model'

type PerLanguage<T> = Record<LanguageCode, T>

async function putTemplateText(kind: BookingTemplateKind, language: LanguageCode, body: string | null) {
  try {
    const res = await fetch('/api/dashboard/settings/booking/templates', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind, language, body }),
    })
    return templateEditResult(res.status, await res.json().catch(() => null), { kind, language, reset: body === null })
  } catch {
    return { outcome: { kind: 'error' } as TemplateEditOutcome, overview: null }
  }
}

const perLanguage = <T>(build: (lang: LanguageCode) => T) =>
  Object.fromEntries(TEMPLATE_LANGUAGES.map((lang) => [lang, build(lang)])) as PerLanguage<T>

export function useBookingTemplateEditor(kind: BookingTemplateKind, slots: BookingTemplateSlotViews, onSaved: (o: TemplateOverview) => void) {
  const textOf = (all: BookingTemplateSlotViews, lang: LanguageCode) => all[kind][lang].customBody ?? all[kind][lang].defaultBody
  const [drafts, setDrafts] = useState<PerLanguage<string>>(() => perLanguage((lang) => textOf(slots, lang)))
  const [outcomes, setOutcomes] = useState<PerLanguage<TemplateEditOutcome | null>>(() => perLanguage(() => null))
  const [saving, setSaving] = useState<LanguageCode | null>(null)
  const checks = useMemo(
    () => perLanguage<BookingBodyCheck>((lang) => validateBookingTemplateBody(kind, lang, drafts[lang])),
    [kind, drafts]
  )

  function setDraft(lang: LanguageCode, text: string) {
    setDrafts((prev) => ({ ...prev, [lang]: text }))
    setOutcomes((prev) => ({ ...prev, [lang]: null }))
  }

  async function submit(lang: LanguageCode, body: string | null) {
    setSaving(lang)
    const { outcome, overview } = await putTemplateText(kind, lang, body)
    setOutcomes((prev) => ({ ...prev, [lang]: outcome }))
    if (overview) {
      setDrafts((prev) => ({ ...prev, [lang]: textOf(overview.slots, lang) }))
      onSaved(overview)
    }
    setSaving(null)
  }

  return {
    drafts, checks, outcomes, saving, setDraft,
    save: (lang: LanguageCode) => submit(lang, drafts[lang]),
    reset: (lang: LanguageCode) => submit(lang, null),
  }
}

/** Inserts a placeholder at the textarea's cursor, then puts the cursor after it. */
export function usePlaceholderInsert(text: string, onChange: (text: string) => void) {
  const ref = useRef<HTMLTextAreaElement>(null)
  function insert(name: string) {
    const el = ref.current
    const next = insertPlaceholder(text, el?.selectionStart ?? text.length, el?.selectionEnd ?? text.length, name)
    onChange(next.text)
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(next.cursor, next.cursor)
    })
  }
  return { ref, insert }
}
