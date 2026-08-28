'use client'

import { useTranslations } from 'next-intl'
import { TagCombobox } from './tag-combobox'
import { CampaignTagRecipientCount } from './campaign-tag-recipient-count'

interface CampaignTagPickerProps {
  selectedIds: string[]
  onChange: (ids: string[]) => void
}

export function CampaignTagPicker({ selectedIds, onChange }: CampaignTagPickerProps) {
  const t = useTranslations('campaigns')
  return (
    <div className="space-y-2">
      <TagCombobox
        selectedIds={selectedIds}
        onChange={onChange}
        multiple
        placeholder={t('selectTags')}
      />
      <p data-field="tag-or-hint" className="text-sm text-muted-foreground">
        {t('tagOrHint')}
      </p>
      <CampaignTagRecipientCount tagIds={selectedIds} />
    </div>
  )
}
