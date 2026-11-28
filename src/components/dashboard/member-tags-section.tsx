'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { TagCombobox } from './tag-combobox'
import {
  type MemberTag,
  fetchMemberTags,
  assignMemberTags,
  removeMemberTag,
} from './member-tags-section-helpers'

interface MemberTagsSectionProps {
  memberId: string
  tags: MemberTag[]
  onChanged?: () => void
}

function RemovableTagChip({ tag, onRemove }: { tag: MemberTag; onRemove: (id: string) => void }) {
  return (
    <Badge variant="outline" className="gap-1">
      <span className="size-2 rounded-full" style={{ backgroundColor: tag.color }} />
      {tag.name}
      <button
        type="button"
        aria-label={`remove ${tag.name}`}
        className="ml-0.5 hover:text-destructive"
        onClick={() => onRemove(tag.id)}
      >
        {'×'}
      </button>
    </Badge>
  )
}

export function MemberTagsSection({ memberId, tags: initialTags, onChanged }: MemberTagsSectionProps) {
  const t = useTranslations('members')
  const [tags, setTags] = useState<MemberTag[]>(initialTags)
  const [pendingIds, setPendingIds] = useState<string[]>([])
  const [busy, setBusy] = useState(false)

  const refresh = async () => setTags(await fetchMemberTags(memberId))

  const handleRemove = async (tagId: string) => {
    setTags((cur) => cur.filter((x) => x.id !== tagId))
    try {
      await removeMemberTag(memberId, tagId)
      onChanged?.()
    } catch {
      await refresh()
    }
  }

  const handleAdd = async () => {
    if (!pendingIds.length || busy) return
    setBusy(true)
    try {
      await assignMemberTags(memberId, pendingIds)
      setPendingIds([])
      await refresh()
      onChanged?.()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold">{t('tagsColumn')}</h3>
      <div className="flex flex-wrap gap-2">
        {tags.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('noTags')}</p>
        ) : (
          tags.map((tag) => <RemovableTagChip key={tag.id} tag={tag} onRemove={handleRemove} />)
        )}
      </div>
      <TagCombobox selectedIds={pendingIds} onChange={setPendingIds} />
      <Button type="button" size="sm" onClick={handleAdd} disabled={!pendingIds.length || busy}>
        {t('addTag')}
      </Button>
    </div>
  )
}
