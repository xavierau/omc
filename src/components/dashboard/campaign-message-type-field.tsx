'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import type { CampaignFormState } from './campaign-form-fields'
import type { WaTemplate } from '@/hooks/use-wa-templates'

const selectClass = 'h-8 w-full rounded-md border border-input bg-background px-3 text-sm'

type OnChange = (key: keyof CampaignFormState, value: string) => void

export function CampaignMessageTypeField({ form, onChange }: { form: CampaignFormState; onChange: OnChange }) {
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
      {form.messageType === 'inline' && (
        <div>
          <textarea value={form.template} onChange={(e) => onChange('template', e.target.value)}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[80px]"
            placeholder={t('formTemplatePlaceholder')} />
          <p className="text-xs text-muted-foreground mt-1">{t('formPlaceholders')}</p>
        </div>
      )}
      {form.messageType === 'wa_template' && (
        <select value={form.whatsappTemplateId} onChange={(e) => onChange('whatsappTemplateId', e.target.value)} className={selectClass}>
          <option value="">{t('selectTemplate')}</option>
          {approvedTemplates.map((tpl) => (
            <option key={tpl.id} value={tpl.id}>{tpl.name} ({tpl.language})</option>
          ))}
        </select>
      )}
    </fieldset>
  )
}
