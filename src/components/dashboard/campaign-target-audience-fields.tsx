'use client'

import { useTranslations } from 'next-intl'
import { CampaignMemberPicker } from './campaign-member-picker'
import type { CampaignFormState } from './campaign-form-types'

type OnChange = (key: keyof CampaignFormState, value: string) => void

interface Props {
  form: CampaignFormState
  onChange: OnChange
  onMemberIdsChange: (ids: string[]) => void
}

export function CampaignTargetAudienceFields({
  form,
  onChange,
  onMemberIdsChange,
}: Props) {
  const t = useTranslations('campaigns')
  return (
    <fieldset className="space-y-3 border border-input rounded-lg p-3">
      <legend className="text-sm font-medium px-1">{t('targetAudience')}</legend>
      <div className="flex gap-4">
        <label className="flex items-center gap-1.5 text-sm">
          <input
            type="radio"
            name="targetAudience"
            value="all"
            checked={form.targetAudience === 'all'}
            onChange={() => onChange('targetAudience', 'all')}
          />
          {t('allMembers')}
        </label>
        <label className="flex items-center gap-1.5 text-sm">
          <input
            type="radio"
            name="targetAudience"
            value="selected"
            checked={form.targetAudience === 'selected'}
            onChange={() => onChange('targetAudience', 'selected')}
          />
          {t('selectMembers')}
        </label>
      </div>
      {form.targetAudience === 'selected' && (
        <CampaignMemberPicker
          selectedIds={form.memberIds}
          onChange={onMemberIdsChange}
        />
      )}
    </fieldset>
  )
}
