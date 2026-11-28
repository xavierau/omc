'use client'

/**
 * BOOK-002 (AC-1..AC-6): the inline editor for one booking message, both
 * languages side by side (stacked on a phone). `BookingTemplateEditorView`
 * is presentational; `BookingTemplateEditor` wires it to the editor hook.
 */
import { X } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { useBookingTemplateEditor } from '@/hooks/use-booking-template-editor'
import { TEMPLATE_LANGUAGES, type BookingTemplateKind } from '@/domain/value-objects/booking-config'
import type { BookingTemplateSlotViews } from '@/application/booking/booking-template-statuses'
import type { TemplateOverview } from '@/hooks/booking-template-editor-model'
import { BookingTemplateLanguageEditor, type LanguageEditorProps } from './booking-template-language-editor'

interface ViewProps {
  kind: BookingTemplateKind
  canEdit: boolean
  languages: LanguageEditorProps[]
  onClose(): void
}

export function BookingTemplateEditorView({ kind, canEdit, languages, onClose }: ViewProps) {
  const t = useTranslations('bookingSettings.templates')
  return (
    <section data-testid="booking-template-editor" aria-labelledby="booking-template-editor-title" className="space-y-4 border-t pt-4">
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-3">
          <h3 id="booking-template-editor-title" className="text-sm font-semibold">{t('editor.title', { kind: t(`kind.${kind}`) })}</h3>
          <Button type="button" variant="ghost" size="icon-sm" onClick={onClose} aria-label={t('editor.close')} data-testid="booking-template-editor-close">
            <X aria-hidden="true" />
          </Button>
        </div>
        <p className="max-w-prose text-pretty text-xs text-muted-foreground">{canEdit ? t('editor.hint') : t('editor.readOnly')}</p>
      </div>
      <div className="grid gap-6 md:grid-cols-2">
        {languages.map((props) => <BookingTemplateLanguageEditor key={props.lang} {...props} />)}
      </div>
    </section>
  )
}

interface EditorProps {
  kind: BookingTemplateKind
  slots: BookingTemplateSlotViews
  canEdit: boolean
  onClose(): void
  onSaved(overview: TemplateOverview): void
}

export function BookingTemplateEditor({ kind, slots, canEdit, onClose, onSaved }: EditorProps) {
  const editor = useBookingTemplateEditor(kind, slots, onSaved)
  const languages = TEMPLATE_LANGUAGES.map((lang): LanguageEditorProps => ({
    lang,
    draft: editor.drafts[lang],
    check: editor.checks[lang],
    placeholders: slots[kind][lang].placeholders,
    canEdit,
    saving: editor.saving === lang,
    busy: editor.saving !== null,
    outcome: editor.outcomes[lang],
    onChange: (text) => editor.setDraft(lang, text),
    onSave: () => editor.save(lang),
    onReset: () => editor.reset(lang),
  }))
  return <BookingTemplateEditorView kind={kind} canEdit={canEdit} languages={languages} onClose={onClose} />
}
