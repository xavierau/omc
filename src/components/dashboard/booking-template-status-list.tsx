'use client'

/**
 * BOOK-001 W3 (AC-1): each booking UTILITY template's status, per language.
 * Until a template is approved, messages outside the diner's 24-hour window
 * are not delivered (staff see the not-delivered badge).
 *
 * BOOK-002: with the editor's slot views, each row also shows its submitted
 * edit (pending / rejected with Meta's reason / not sent) and an Edit text
 * action (View text for non-admins).
 */
import { useTranslations } from 'next-intl'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { TEMPLATE_KINDS, TEMPLATE_LANGUAGES, type BookingTemplateKind } from '@/domain/value-objects/booking-config'
import type { BookingTemplateStatus, BookingTemplateStatuses } from '@/domain/services/booking-templates'
import type { BookingTemplateEditorAccess } from '@/hooks/use-booking-availability'
import { BookingTemplateCandidateBadges, BookingTemplateCandidateNotes } from './booking-template-candidate-notes'

const VARIANT: Record<BookingTemplateStatus, { variant: 'default' | 'outline' | 'secondary'; className?: string }> = {
  approved: { variant: 'default' },
  pending: { variant: 'outline' },
  rejected: { variant: 'outline', className: 'border-destructive text-foreground' },
  failed: { variant: 'outline', className: 'border-destructive text-foreground' },
  not_submitted: { variant: 'secondary' },
}

function NoStatuses({ loading }: { loading: boolean }) {
  const t = useTranslations('bookingSettings')
  return loading ? (
    <p data-testid="booking-template-status-loading" role="status" className="text-xs text-muted-foreground">{t('templates.loading')}</p>
  ) : (
    <p data-testid="booking-template-status-unknown" className="text-xs text-muted-foreground">{t('templates.unknown')}</p>
  )
}

interface EditProps {
  editor?: BookingTemplateEditorAccess | null
  editingKind?: BookingTemplateKind | null
  onEdit?: (kind: BookingTemplateKind) => void
}

function EditAction({ kind, editor, editingKind, onEdit }: EditProps & { kind: BookingTemplateKind }) {
  const t = useTranslations('bookingSettings.templates.editor')
  if (!editor || !onEdit) return null
  return (
    <Button type="button" variant="outline" size="xs" onClick={() => onEdit(kind)} aria-expanded={editingKind === kind}
      data-testid={`booking-template-editor-open-${kind}`}>
      {editor.canEdit ? t('open') : t('view')}
    </Button>
  )
}

export function BookingTemplateStatusList({ statuses, loading = false, ...edit }: { statuses: BookingTemplateStatuses | null; loading?: boolean } & EditProps) {
  const t = useTranslations('bookingSettings')
  return (
    <div className="space-y-2" data-testid="booking-template-statuses">
      <p className="text-sm font-medium">{t('templates.title')}</p>
      <p className="text-xs text-muted-foreground">{t('templates.hint')}</p>
      {statuses ? (
        <ul className="divide-y border-y text-sm">
          {TEMPLATE_KINDS.map((kind) => (
            <li key={kind} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span>{t(`templates.kind.${kind}`)}</span>
              <span className="flex flex-wrap items-center gap-2">
                {TEMPLATE_LANGUAGES.map((lang) => {
                  const status = statuses[kind][lang]
                  return (
                    <Badge key={lang} variant={VARIANT[status].variant} className={VARIANT[status].className}
                      data-testid={`booking-template-status-${kind}-${lang}`}>
                      {t(`templates.status.${status}`)} · {t(`templates.lang.${lang}`)}
                    </Badge>
                  )
                })}
                {edit.editor ? <BookingTemplateCandidateBadges kind={kind} slots={edit.editor.slots} /> : null}
                <EditAction kind={kind} {...edit} />
              </span>
              {edit.editor ? <BookingTemplateCandidateNotes kind={kind} slots={edit.editor.slots} /> : null}
            </li>
          ))}
        </ul>
      ) : (
        <NoStatuses loading={loading} />
      )}
    </div>
  )
}
