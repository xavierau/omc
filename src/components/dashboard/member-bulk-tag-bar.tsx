'use client'

// TAG-001 F4 — members-list bulk tag/untag bar. Visible only when the caller
// has at least one member selected. Fetches the tenant tag list itself (same
// fetchTags() pattern F1's csv-tag-summary uses) purely to resolve chosen tag
// ids to names for the success-line copy — the TagCombobox below does its own
// independent fetch for its chip list.
import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { TagCombobox } from './tag-combobox'
import { fetchTags } from '@/hooks/tag-client'
import { bulkUpdateMemberTags, joinTagNames, type BulkTagAction } from './member-bulk-tag-helpers'
import type { Tag } from '@/domain/entities/tag'

interface MemberBulkTagBarProps {
  selectedIds: string[]
  onClear: () => void
  onSuccess: () => void
}

interface StatusLine {
  variant: 'success' | 'error'
  text: string
}

export function MemberBulkTagBar({ selectedIds, onClear, onSuccess }: MemberBulkTagBarProps) {
  const t = useTranslations('members')
  const [tags, setTags] = useState<Tag[]>([])
  const [tagIds, setTagIds] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<StatusLine | null>(null)

  const hasSelection = selectedIds.length > 0

  useEffect(() => {
    if (!hasSelection) return
    fetchTags().then(setTags).catch(() => setTags([]))
  }, [hasSelection])

  // Stay mounted while a status line is pending even after the selection
  // clears (onSuccess clears it in the same batch as setStatus below) so
  // the success/error line has a chance to paint. Feedback State 7.
  if (selectedIds.length === 0 && !status) return null

  const disabled = tagIds.length === 0 || busy

  const run = async (action: BulkTagAction) => {
    if (disabled) return
    setBusy(true)
    setStatus(null)
    const result = await bulkUpdateMemberTags({ memberIds: selectedIds, tagIds, action })
    setBusy(false)
    if (result.ok) {
      const tagNames = joinTagNames(tagIds, tags)
      const count = action === 'add' ? selectedIds.length : (result.affected ?? 0)
      const key = action === 'add' ? 'bulkTagSuccess' : 'bulkUntagSuccess'
      setStatus({ variant: 'success', text: t(key, { tags: tagNames, count }) })
      setTagIds([])
      onSuccess()
    } else {
      setStatus({ variant: 'error', text: t(result.errorKey ?? 'bulkTagFailed') })
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border p-3" data-section="bulk-tag-bar">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">{t('selectedCount', { count: selectedIds.length })}</span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            setStatus(null)
            onClear()
          }}
          data-action="bulk-clear"
        >
          {t('clearSelection')}
        </Button>
      </div>
      <TagCombobox selectedIds={tagIds} onChange={setTagIds} />
      <div className="flex gap-2">
        <Button type="button" size="sm" disabled={disabled} onClick={() => run('add')} data-action="bulk-add-tags">
          {t('bulkAddTags')}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled}
          onClick={() => run('remove')}
          data-action="bulk-remove-tags"
        >
          {t('bulkRemoveTags')}
        </Button>
      </div>
      {busy && (
        <p className="text-sm text-muted-foreground" data-status="working">
          {t('bulkWorking')}
        </p>
      )}
      {!busy && status && (
        <p
          className={status.variant === 'success' ? 'text-sm text-muted-foreground' : 'text-sm text-destructive'}
          data-status={status.variant}
        >
          {status.text}
        </p>
      )}
    </div>
  )
}
