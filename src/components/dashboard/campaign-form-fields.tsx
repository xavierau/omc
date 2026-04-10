'use client'

import { useTranslations } from 'next-intl'
import { Input } from '@/components/ui/input'
import { CampaignMessageTypeField } from './campaign-message-type-field'
import { CampaignMemberPicker } from './campaign-member-picker'

export interface CampaignFormState {
  name: string
  type: string
  template: string
  messageType: 'inline' | 'wa_template'
  whatsappTemplateId: string
  discountType: string
  discountValue: string
  expiresInDays: string
  execution: 'now' | 'schedule'
  scheduledAt: string
  targetAudience: 'all' | 'selected'
  memberIds: string[]
}

export const initialCampaignForm: CampaignFormState = {
  name: '', type: 'winback', template: '',
  messageType: 'inline', whatsappTemplateId: '',
  discountType: 'percentage', discountValue: '', expiresInDays: '30',
  execution: 'now', scheduledAt: '',
  targetAudience: 'all', memberIds: [],
}

const selectClass = 'h-8 w-full rounded-md border border-input bg-background px-3 text-sm'

type OnChange = (key: keyof CampaignFormState, value: string) => void

interface CampaignFormFieldsProps {
  form: CampaignFormState
  onChange: OnChange
  onMemberIdsChange: (ids: string[]) => void
}

export function CampaignFormFields({ form, onChange, onMemberIdsChange }: CampaignFormFieldsProps) {
  const t = useTranslations('campaigns')

  return (
    <div className="space-y-4 mt-4">
      <Field label={t('formName')}>
        <Input value={form.name} onChange={(e) => onChange('name', e.target.value)} placeholder={t('formNamePlaceholder')} />
      </Field>
      <Field label={t('formType')}>
        <select value={form.type} onChange={(e) => onChange('type', e.target.value)} className={selectClass}>
          <option value="winback">{t('formWinback')}</option>
          <option value="promo">{t('formPromo')}</option>
        </select>
      </Field>
      <TargetAudienceFields form={form} onChange={onChange} onMemberIdsChange={onMemberIdsChange} />
      <CampaignMessageTypeField form={form} onChange={onChange} />
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
        <Input type="number" value={form.discountValue} onChange={(e) => onChange('discountValue', e.target.value)}
          placeholder={form.discountType === 'percentage' ? '20' : '50'} />
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
          <input type="radio" checked={form.execution === 'now'} onChange={() => onChange('execution', 'now')} />
          {t('executionNow')}
        </label>
        <label className="flex items-center gap-1.5 text-sm">
          <input type="radio" checked={form.execution === 'schedule'} onChange={() => onChange('execution', 'schedule')} />
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

function TargetAudienceFields({ form, onChange, onMemberIdsChange }: { form: CampaignFormState; onChange: OnChange; onMemberIdsChange: (ids: string[]) => void }) {
  const t = useTranslations('campaigns')

  return (
    <fieldset className="space-y-3 border border-input rounded-lg p-3">
      <legend className="text-sm font-medium px-1">{t('targetAudience')}</legend>
      <div className="flex gap-4">
        <label className="flex items-center gap-1.5 text-sm">
          <input type="radio" checked={form.targetAudience === 'all'} onChange={() => onChange('targetAudience', 'all')} />
          {t('allMembers')}
        </label>
        <label className="flex items-center gap-1.5 text-sm">
          <input type="radio" checked={form.targetAudience === 'selected'} onChange={() => onChange('targetAudience', 'selected')} />
          {t('selectMembers')}
        </label>
      </div>
      {form.targetAudience === 'selected' && (
        <CampaignMemberPicker selectedIds={form.memberIds} onChange={onMemberIdsChange} />
      )}
    </fieldset>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="text-sm font-medium text-foreground mb-1 block">{label}</label>{children}</div>
}

export function buildCampaignRequestBody(form: CampaignFormState) {
  const discountValue = Number(form.discountValue)
  const useWaTemplate = form.messageType === 'wa_template'
  return {
    name: form.name,
    type: form.type,
    template: useWaTemplate ? '' : form.template,
    whatsappTemplateId: useWaTemplate ? form.whatsappTemplateId : null,
    couponConfig: discountValue > 0 ? {
      discountType: form.discountType,
      discountValue,
      expiresInDays: Number(form.expiresInDays) || 30,
    } : null,
    scheduledAt: form.execution === 'schedule' && form.scheduledAt
      ? new Date(form.scheduledAt).toISOString()
      : null,
    status: 'active',
    targetAudience: form.targetAudience,
    ...(form.targetAudience === 'selected' ? { memberIds: form.memberIds } : {}),
  }
}
