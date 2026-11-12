'use client'

/**
 * BOOK-002 (AC-1, AC-4, AC-5, AC-6): one language of a booking message —
 * the text, detail chips that insert at the cursor, a live preview with
 * sample details (plain text, never HTML), inline errors and warnings, and
 * Save / Reset to default. Read-only for non-admins.
 */
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { usePlaceholderInsert } from '@/hooks/use-booking-template-editor'
import { isFailedOutcome, previewText, type TemplateEditOutcome } from '@/hooks/booking-template-editor-model'
import type { BookingBodyCheck } from '@/domain/services/booking-template-body'
import type { LanguageCode } from '@/domain/value-objects/language'
import { BookingTemplateIssues } from './booking-template-issues'

export interface LanguageEditorProps {
  lang: LanguageCode
  draft: string
  check: BookingBodyCheck
  placeholders: string[]
  canEdit: boolean
  saving: boolean
  busy: boolean
  outcome: TemplateEditOutcome | null
  onChange(text: string): void
  onSave(): void
  onReset(): void
}

function Chips(props: { lang: LanguageCode; placeholders: string[]; onInsert(name: string): void }) {
  const t = useTranslations('bookingSettings.templates.editor')
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={t('insert')}>
      <span className="text-xs text-muted-foreground">{t('insert')}</span>
      {props.placeholders.map((name) => (
        <Button key={name} type="button" variant="outline" size="xs" onClick={() => props.onInsert(name)}
          aria-label={t('insertLabel', { detail: t(`placeholder.${name}`) })} data-testid={`booking-template-editor-${props.lang}-chip-${name}`}>
          {t(`placeholder.${name}`)}
        </Button>
      ))}
    </div>
  )
}

function Outcome({ lang, outcome }: { lang: LanguageCode; outcome: TemplateEditOutcome | null }) {
  const t = useTranslations('bookingSettings.templates.editor')
  if (!outcome) return null
  const failed = isFailedOutcome(outcome)
  return (
    <p data-testid={`booking-template-editor-${lang}-outcome`} role={failed ? 'alert' : 'status'}
      className={failed ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'}>
      {t(`outcome.${outcome.kind}`)}
    </p>
  )
}

function Actions(props: LanguageEditorProps & { language: string }) {
  const t = useTranslations('bookingSettings.templates.editor')
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" size="sm" onClick={props.onSave} disabled={props.busy || props.check.errors.length > 0}
        aria-label={t('saveLabel', { language: props.language })} data-testid={`booking-template-editor-${props.lang}-save`}>
        {props.saving ? t('saving') : t('save')}
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={props.onReset} disabled={props.busy}
        aria-label={t('resetLabel', { language: props.language })} data-testid={`booking-template-editor-${props.lang}-reset`}>
        {t('reset')}
      </Button>
      <Outcome lang={props.lang} outcome={props.outcome} />
    </div>
  )
}

export function BookingTemplateLanguageEditor(props: LanguageEditorProps) {
  const t = useTranslations('bookingSettings.templates')
  const { ref, insert } = usePlaceholderInsert(props.draft, props.onChange)
  const id = `booking-template-editor-${props.lang}-input`
  const language = t(`lang.${props.lang}`)
  return (
    <div className="min-w-0 space-y-2.5">
      <label htmlFor={id} className="text-sm font-medium">{language}</label>
      <textarea id={id} ref={ref} value={props.draft} rows={5} readOnly={!props.canEdit} lang={props.lang === 'en' ? 'en' : 'zh-HK'}
        aria-invalid={props.check.errors.length > 0} onChange={(e) => props.onChange(e.target.value)} data-testid={id}
        className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm leading-relaxed outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive read-only:bg-muted/40" />
      {props.canEdit ? <Chips lang={props.lang} placeholders={props.placeholders} onInsert={insert} /> : null}
      <BookingTemplateIssues lang={props.lang} check={props.check} />
      <div className="space-y-1">
        <p className="text-xs text-muted-foreground">{t('editor.preview')}</p>
        <p data-testid={`booking-template-editor-${props.lang}-preview`}
          className="max-w-prose whitespace-pre-wrap break-words rounded-lg bg-muted/60 px-3 py-2 text-sm leading-relaxed">
          {previewText(props.lang, props.draft)}
        </p>
      </div>
      {props.canEdit ? <Actions {...props} language={language} /> : null}
    </div>
  )
}
