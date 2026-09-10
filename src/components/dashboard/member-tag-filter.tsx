'use client'

import { useTranslations } from 'next-intl'
import { TagCombobox } from './tag-combobox'

interface MemberTagFilterProps {
  tagId: string | null
  onChange: (tagId: string | null) => void
}

export function MemberTagFilter({ tagId, onChange }: MemberTagFilterProps) {
  const t = useTranslations('members')

  return (
    <TagCombobox
      multiple={false}
      selectedIds={tagId ? [tagId] : []}
      onChange={(ids) => onChange(ids[0] ?? null)}
      placeholder={t('filterByTag')}
    />
  )
}
