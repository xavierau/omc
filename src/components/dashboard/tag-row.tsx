'use client'

// TAG-001 — Stream Bf: presentational row for the tag manager. Pure (state lives in
// the container) so it renders one of three modes: view (rename/delete actions),
// confirm (inline delete confirmation — never a blocking window.confirm), or edit
// (delegates to the shared TagForm in rename mode).

import { useTranslations } from 'next-intl'
import type { Tag } from '@/domain/entities/tag'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { TagForm } from '@/components/dashboard/tag-form'

export type TagRowMode = 'view' | 'edit' | 'confirm'

interface TagRowProps {
  tag: Tag
  mode: TagRowMode
  busy: boolean
  onEdit: () => void
  onDelete: () => void
  onConfirmDelete: () => void
  onCancel: () => void
  onRenamed: (tag: Tag) => void
}

export function TagRow(props: TagRowProps) {
  const { tag, mode, onRenamed, onCancel } = props
  const t = useTranslations('tags')

  if (mode === 'edit') {
    return (
      <div className="py-2">
        <TagForm tag={tag} onSaved={onRenamed} onCancel={onCancel} />
      </div>
    )
  }

  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <TagLabel tag={tag} />
      {mode === 'confirm' ? (
        <ConfirmDelete busy={props.busy} onConfirm={props.onConfirmDelete} onCancel={onCancel} />
      ) : (
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" onClick={props.onEdit}>{t('rename')}</Button>
          <Button size="sm" variant="ghost" onClick={props.onDelete}>{t('delete')}</Button>
        </div>
      )}
    </div>
  )
}

function TagLabel({ tag }: { tag: Tag }) {
  return (
    <Badge variant="outline" className="gap-1.5">
      <span className="size-2 rounded-full" style={{ backgroundColor: tag.color }} />
      <span className="font-medium">{tag.name}</span>
    </Badge>
  )
}

function ConfirmDelete({ busy, onConfirm, onCancel }: {
  busy: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  const t = useTranslations('tags')
  const tc = useTranslations('common')
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted-foreground">{t('deleteConfirm')}</span>
      <Button size="sm" variant="destructive" onClick={onConfirm} disabled={busy}>{t('delete')}</Button>
      <Button size="sm" variant="ghost" onClick={onCancel} disabled={busy}>{tc('cancel')}</Button>
    </div>
  )
}
