'use client'

import { useTranslations } from 'next-intl'
import { Input } from '@/components/ui/input'
import { CampaignMessageTypeField } from './campaign-message-type-field'
import { CampaignTargetAudienceFields } from './campaign-target-audience-fields'
import { WelcomeImageFields } from './welcome-image-fields'
import type { CampaignFormState } from './campaign-form-types'

export type { CampaignFormState, CampaignRequestBody } from './campaign-form-types'
export {
  initialCampaignForm,
  CAMPAIGN_TEMPLATE_PLACEHOLDERS,
  buildCampaignRequestBody,
  validateCampaignForm,
} from './campaign-form-types'

const selectClass = 'h-8 w-full rounded-md border border-input bg-background px-3 text-sm'

type OnChange = (key: keyof CampaignFormState, value: string) => void

interface CampaignFormFieldsProps {
  form: CampaignFormState
  campaignId?: string | null
  draftNonce: string
  onChange: OnChange
  onMemberIdsChange: (ids: string[]) => void
  onTagIdsChange: (ids: string[]) => void
  onTemplateChange: (next: { en: string; zhHk: string }) => void
}

export function CampaignFormFields({
  form,
  campaignId,
  draftNonce,
  onChange,
  onMemberIdsChange,
  onTagIdsChange,
  onTemplateChange,
}: CampaignFormFieldsProps) {
  const t = useTranslations('campaigns')
  return (
    <div className="space-y-4 mt-4">
      <Field label={t('formName')}>
        <Input
          value={form.name}
          onChange={(e) => onChange('name', e.target.value)}
          placeholder={t('formNamePlaceholder')}
        />
      </Field>
      <Field label={t('formType')}>
        <select value={form.type} onChange={(e) => onChange('type', e.target.value)} className={selectClass}>
          <option value="welcome">{t('formWelcome')}</option>
          <option value="winback">{t('formWinback')}</option>
          <option value="promo">{t('formPromo')}</option>
        </select>
      </Field>
      <CampaignTargetAudienceFields
        form={form}
        onChange={onChange}
        onMemberIdsChange={onMemberIdsChange}
        onTagIdsChange={onTagIdsChange}
      />
      <CampaignMessageTypeField form={form} onChange={onChange} onTemplateChange={onTemplateChange} />
      {form.type === 'welcome' && (
        <WelcomeImageFields
          form={form}
          campaignId={campaignId ?? null}
          draftNonce={draftNonce}
          onChange={onChange}
        />
      )}
      <CouponConfigFields form={form} onChange={onChange} />
      <ExecutionFields form={form} onChange={onChange} />
    </div>
  )
}

function CouponConfigFields({ form, onChange }: { form: CampaignFormState; onChange: OnChange }) {
  const t = useTranslations('campaigns')
  return (
    <fieldset className="space-y-3 border border-input rounded-lg p-3">
      <legend className="text-sm font-medium px-1">{t('couponConfig')}</legend>
      <Field label={t('discountType')}>
        <select value={form.discountType} onChange={(e) => onChange('discountType', e.target.value)} className={selectClass}>
          <option value="percentage">{t('percentage')}</option>
          <option value="fixed_amount">{t('fixedAmount')}</option>
        </select>
      </Field>
      <Field label={t('discountValue')}>
        <Input
          type="number"
          value={form.discountValue}
          onChange={(e) => onChange('discountValue', e.target.value)}
          placeholder={form.discountType === 'percentage' ? '20' : '50'}
        />
      </Field>
      <Field label={t('expiryDays')}>
        <Input type="number" value={form.expiresInDays} onChange={(e) => onChange('expiresInDays', e.target.value)} placeholder="30" />
      </Field>
    </fieldset>
  )
}

function ExecutionFields({ form, onChange }: { form: CampaignFormState; onChange: OnChange }) {
  const t = useTranslations('campaigns')
  return (
    <fieldset className="space-y-3 border border-input rounded-lg p-3">
      <legend className="text-sm font-medium px-1">{t('execution')}</legend>
      <div className="flex gap-4">
        <label className="flex items-center gap-1.5 text-sm">
          <input
            type="radio"
            name="execution"
            value="now"
            checked={form.execution === 'now'}
            onChange={() => onChange('execution', 'now')}
          />
          {t('executionNow')}
        </label>
        <label className="flex items-center gap-1.5 text-sm">
          <input
            type="radio"
            name="execution"
            value="schedule"
            checked={form.execution === 'schedule'}
            onChange={() => onChange('execution', 'schedule')}
          />
          {t('executionSchedule')}
        </label>
      </div>
      {form.execution === 'schedule' && (
        <Field label={t('scheduledAt')}>
          <Input type="datetime-local" value={form.scheduledAt} onChange={(e) => onChange('scheduledAt', e.target.value)} />
        </Field>
      )}
    </fieldset>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-sm font-medium text-foreground mb-1 block">{label}</label>
      {children}
    </div>
  )
}
