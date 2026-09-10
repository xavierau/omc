'use client'

import { useTranslations } from 'next-intl'
import { TagCombobox } from '@/components/dashboard/tag-combobox'

interface Props {
  selectedIds: string[]
  onChange: (ids: string[]) => void
}

export function BatchTagSelector({ selectedIds, onChange }: Props) {
  const t = useTranslations('importWizard')
  return (
    <div className="space-y-1" data-field="tags">
      <label className="text-sm font-medium text-foreground">
        {t('meta.tags')}
      </label>
      <TagCombobox selectedIds={selectedIds} onChange={onChange} multiple />
      <p className="text-xs text-muted-foreground">{t('meta.tagsHint')}</p>
    </div>
  )
}
