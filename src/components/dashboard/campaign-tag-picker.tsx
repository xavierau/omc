'use client'

import { useTranslations } from 'next-intl'
import { TagCombobox } from './tag-combobox'

interface CampaignTagPickerProps {
  selectedIds: string[]
  onChange: (ids: string[]) => void
}

export function CampaignTagPicker({ selectedIds, onChange }: CampaignTagPickerProps) {
  const t = useTranslations('campaigns')
  return (
    <TagCombobox
      selectedIds={selectedIds}
      onChange={onChange}
      multiple={false}
      placeholder={t('selectTag')}
    />
  )
}
