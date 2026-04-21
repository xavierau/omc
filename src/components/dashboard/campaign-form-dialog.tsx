'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { CampaignFormFields } from './campaign-form-fields'
import {
  initialCampaignForm,
  buildCampaignRequestBody,
  validateCampaignForm,
  type CampaignFormState,
} from './campaign-form-types'
import type { Campaign } from '@/domain/entities/campaign'

interface CampaignFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
  campaign?: Campaign | null
}

function campaignToFormState(c: Campaign): CampaignFormState {
  return {
    name: c.name ?? '',
    type: c.type,
    templateEn: c.templateEn ?? '',
    templateZhHk: c.templateZhHk ?? '',
    messageType: c.whatsappTemplateId ? 'wa_template' : 'inline',
    whatsappTemplateId: c.whatsappTemplateId ?? '',
    discountType: c.couponConfig?.discountType ?? 'percentage',
    discountValue: c.couponConfig?.discountValue?.toString() ?? '',
    expiresInDays: c.couponConfig?.expiresInDays?.toString() ?? '30',
    execution: c.scheduledAt ? 'schedule' : 'now',
    scheduledAt: c.scheduledAt ? c.scheduledAt.slice(0, 16) : '',
    targetAudience: c.targetAudience ?? 'all',
    memberIds: [],
  }
}

async function submitCampaign(form: CampaignFormState, campaignId: string | undefined) {
  const body = buildCampaignRequestBody(form)
  const url = campaignId ? `/api/dashboard/campaigns/${campaignId}` : '/api/dashboard/campaigns'
  const method = campaignId ? 'PATCH' : 'POST'
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error ?? 'Request failed')
  }
  const json = await res.json()
  if (!campaignId && form.execution === 'now' && json.id) {
    await fetch(`/api/dashboard/campaigns/${json.id}/execute`, { method: 'POST' })
  }
  return json
}

export function CampaignFormDialog({ open, onOpenChange, onSuccess, campaign }: CampaignFormDialogProps) {
  const t = useTranslations('campaigns')
  const tc = useTranslations('common')
  const isEdit = !!campaign
  const [form, setForm] = useState<CampaignFormState>(initialCampaignForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!campaign) { setForm(initialCampaignForm); return }
    setForm(campaignToFormState(campaign))
    if (campaign.targetAudience === 'selected') {
      fetch(`/api/dashboard/campaigns/${campaign.id}`)
        .then((res) => res.json())
        .then((d) => d.memberIds && setForm((p) => ({ ...p, memberIds: d.memberIds })))
        .catch(() => {})
    }
  }, [campaign])

  const handleClose = () => { setForm(initialCampaignForm); onOpenChange(false) }
  const handleChange = (key: keyof CampaignFormState, value: string) =>
    setForm((p) => ({ ...p, [key]: value }))
  const handleTemplateChange = (n: { en: string; zhHk: string }) =>
    setForm((p) => ({ ...p, templateEn: n.en, templateZhHk: n.zhHk }))

  async function handleSubmit() {
    const key = validateCampaignForm(form)
    if (key) { setError(t(key)); return }
    setSaving(true); setError(null)
    try {
      await submitCampaign(form, campaign?.id)
      onSuccess(); handleClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : (isEdit ? t('updateError') : 'Error'))
    } finally {
      setSaving(false)
    }
  }

  const submitLabel = saving
    ? (isEdit ? tc('saving') : tc('creating'))
    : (isEdit ? tc('save') : tc('create'))

  return (
    <Sheet open={open} onOpenChange={(o) => !o && handleClose()}>
      <SheetContent className="w-[400px] sm:w-[540px] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{isEdit ? t('editCampaign') : t('createCampaign')}</SheetTitle>
        </SheetHeader>
        <div className="px-4 pb-4">
          <CampaignFormFields
            form={form}
            onChange={handleChange}
            onMemberIdsChange={(ids) => setForm((p) => ({ ...p, memberIds: ids }))}
            onTemplateChange={handleTemplateChange}
          />
          {error && <p className="text-sm text-destructive mt-2">{error}</p>}
          <div className="flex gap-2 mt-6">
            <Button onClick={handleSubmit} disabled={saving}>{submitLabel}</Button>
            <Button variant="outline" onClick={handleClose}>{tc('cancel')}</Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
