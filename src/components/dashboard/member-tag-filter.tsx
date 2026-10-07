'use client'

import { useTranslations } from 'next-intl'
import { Badge } from '@/components/ui/badge'
import { NO_TAG_FILTER } from '@/lib/constants'
import { TagCombobox } from './tag-combobox'

interface MemberTagFilterProps {
  tagId: string | null
  onChange: (tagId: string | null) => void
}

export function MemberTagFilter({ tagId, onChange }: MemberTagFilterProps) {
  const t = useTranslations('members')
  const noTag = tagId === NO_TAG_FILTER

  return (
    <div className="space-y-2">
      <Badge asChild variant={noTag ? 'default' : 'outline'}>
        <button
          type="button"
          aria-pressed={noTag}
          data-testid="members-tag-filter-no-tag"
          onClick={() => onChange(noTag ? null : NO_TAG_FILTER)}
        >
          {t('noTagOption')}
        </button>
      </Badge>
      <TagCombobox
        multiple={false}
        selectedIds={tagId && !noTag ? [tagId] : []}
        onChange={(ids) => onChange(ids[0] ?? null)}
        placeholder={t('filterByTag')}
      />
    </div>
  )
}
