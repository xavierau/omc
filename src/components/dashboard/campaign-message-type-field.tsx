'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import type { CampaignFormState } from './campaign-form-types'
import { CAMPAIGN_TEMPLATE_PLACEHOLDERS } from './campaign-form-types'
import { BilingualTemplateEditor } from './bilingual-template-editor'
import type { WaTemplate } from '@/hooks/use-wa-templates'

const selectClass = 'h-8 w-full rounded-md border border-input bg-background px-3 text-sm'

type OnChange = (key: keyof CampaignFormState, value: string) => void

interface CampaignMessageTypeFieldProps {
  form: CampaignFormState
  onChange: OnChange
  onTemplateChange: (next: { en: string; zhHk: string }) => void
}

export function CampaignMessageTypeField({
  form,
  onChange,
  onTemplateChange,
}: CampaignMessageTypeFieldProps) {
  const t = useTranslations('campaigns')
  const [approvedTemplates, setApprovedTemplates] = useState<WaTemplate[]>([])

  useEffect(() => {
    if (form.messageType !== 'wa_template') return
    fetch('/api/dashboard/wa-templates?status=approved')
      .then((r) => r.json())
      .then((j) => setApprovedTemplates(j.templates ?? []))
      .catch(() => setApprovedTemplates([]))
  }, [form.messageType])

  return (
    <fieldset className="space-y-3 border border-input rounded-lg p-3">
      <legend className="text-sm font-medium px-1">{t('messageType')}</legend>
      <MessageTypeRadios form={form} onChange={onChange} />
      {form.messageType === 'inline' && (
        <InlineTemplateEditor
          value={{ en: form.templateEn, zhHk: form.templateZhHk }}
          onChange={onTemplateChange}
        />
      )}
      {form.messageType === 'wa_template' && (
        <WaTemplateSelect
          value={form.whatsappTemplateId}
          templates={approvedTemplates}
          onChange={(v) => onChange('whatsappTemplateId', v)}
        />
      )}
    </fieldset>
  )
}

function MessageTypeRadios({ form, onChange }: { form: CampaignFormState; onChange: OnChange }) {
  const t = useTranslations('campaigns')
  return (
    <div className="flex gap-4">
      <label className="flex items-center gap-1.5 text-sm">
        <input type="radio" checked={form.messageType === 'inline'} onChange={() => onChange('messageType', 'inline')} />
        {t('inlineText')}
      </label>
      <label className="flex items-center gap-1.5 text-sm">
        <input type="radio" checked={form.messageType === 'wa_template'} onChange={() => onChange('messageType', 'wa_template')} />
        {t('waTemplate')}
      </label>
    </div>
  )
}

function InlineTemplateEditor({
  value,
  onChange,
}: {
  value: { en: string; zhHk: string }
  onChange: (next: { en: string; zhHk: string }) => void
}) {
  const t = useTranslations('campaigns')
  return (
    <div>
      <BilingualTemplateEditor
        idPrefix="campaign-template"
        placeholders={CAMPAIGN_TEMPLATE_PLACEHOLDERS}
        value={value}
        onChange={onChange}
        translationNamespace="campaigns"
      />
      <p className="text-xs text-muted-foreground mt-1">{t('formPlaceholders')}</p>
    </div>
  )
}

function WaTemplateSelect({
  value,
  templates,
  onChange,
}: {
  value: string
  templates: WaTemplate[]
  onChange: (v: string) => void
}) {
  const t = useTranslations('campaigns')
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={selectClass}>
      <option value="">{t('selectTemplate')}</option>
      {templates.map((tpl) => (
        <option key={tpl.id} value={tpl.id}>
          {tpl.name} ({tpl.language})
        </option>
      ))}
    </select>
  )
}
