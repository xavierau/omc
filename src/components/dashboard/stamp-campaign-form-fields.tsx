'use client'

import { useTranslations } from 'next-intl'
import { Input } from '@/components/ui/input'
import type { StampCampaignFormState } from './stamp-campaign-form-types'
import type { RewardItem } from '@/hooks/use-rewards'

const selectClass = 'h-8 w-full rounded-md border border-input bg-background px-3 text-sm'

type OnChange = (key: keyof StampCampaignFormState, value: string) => void

interface StampCampaignFormFieldsProps {
  form: StampCampaignFormState
  rewards: RewardItem[]
  onChange: OnChange
}

export function StampCampaignFormFields({ form, rewards, onChange }: StampCampaignFormFieldsProps) {
  const t = useTranslations('stampCampaigns')
  const showCapWarning = Number(form.maxStampsPerDay) > 1

  return (
    <div className="space-y-4 mt-4">
      <Field label={t('formName')}>
        <Input value={form.name} onChange={(e) => onChange('name', e.target.value)} placeholder={t('formNamePlaceholder')} />
      </Field>
      <Field label={t('formNameZh')}>
        <Input value={form.nameZh} onChange={(e) => onChange('nameZh', e.target.value)} placeholder={t('formNameZhPlaceholder')} />
      </Field>
      <Field label={t('formStampsRequired')}>
        <Input type="number" min={1} value={form.stampsRequired} onChange={(e) => onChange('stampsRequired', e.target.value)} />
      </Field>
      <Field label={t('formReward')}>
        <select value={form.rewardId} onChange={(e) => onChange('rewardId', e.target.value)} className={selectClass}>
          <option value="">{t('formRewardPlaceholder')}</option>
          {rewards.map((r) => (
            <option key={r.id} value={r.id}>{r.name}</option>
          ))}
        </select>
      </Field>
      <Field label={t('formMaxPerDay')}>
        <Input type="number" min={1} value={form.maxStampsPerDay} onChange={(e) => onChange('maxStampsPerDay', e.target.value)} />
        <p className="text-xs text-muted-foreground mt-1">{t('formMaxPerDayHint')}</p>
        {showCapWarning && (
          <p className="text-xs text-amber-600 dark:text-amber-500 mt-1" data-testid="cap-warning">
            {t('capWarning')}
          </p>
        )}
      </Field>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-sm font-medium mb-1.5 block">{label}</label>
      {children}
    </div>
  )
}
