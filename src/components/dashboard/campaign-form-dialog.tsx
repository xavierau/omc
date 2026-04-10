'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { CampaignFormFields, initialCampaignForm, buildCampaignRequestBody } from './campaign-form-fields'
import type { CampaignFormState } from './campaign-form-fields'
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
    template: c.template,
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

export function CampaignFormDialog({ open, onOpenChange, onSuccess, campaign }: CampaignFormDialogProps) {
  const t = useTranslations('campaigns')
  const tc = useTranslations('common')
  const isEdit = !!campaign
  const [form, setForm] = useState<CampaignFormState>(initialCampaignForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (campaign) {
      setForm(campaignToFormState(campaign))
      if (campaign.targetAudience === 'selected') {
        fetch(`/api/dashboard/campaigns/${campaign.id}`)
          .then((res) => res.json())
          .then((data) => {
            if (data.memberIds) {
              setForm((prev) => ({ ...prev, memberIds: data.memberIds }))
            }
          })
          .catch(() => {})
      }
    } else {
      setForm(initialCampaignForm)
    }
  }, [campaign])

  const handleClose = () => { setForm(initialCampaignForm); onOpenChange(false) }

  const handleChange = (key: keyof CampaignFormState, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  const handleMemberIdsChange = (ids: string[]) => {
    setForm((prev) => ({ ...prev, memberIds: ids }))
  }

  const handleSubmit = async () => {
    if (!form.name.trim()) { setError(t('nameRequired')); return }
    const needsInlineTemplate = form.messageType === 'inline' && !form.template.trim()
    const needsWaTemplate = form.messageType === 'wa_template' && !form.whatsappTemplateId
    if (needsInlineTemplate || needsWaTemplate) { setError(t('templateRequired')); return }

    setSaving(true)
    setError(null)
    try {
      const body = buildCampaignRequestBody(form)
      const url = isEdit ? `/api/dashboard/campaigns/${campaign.id}` : '/api/dashboard/campaigns'
      const method = isEdit ? 'PATCH' : 'POST'
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}))
        throw new Error(errBody.error || (isEdit ? t('updateError') : 'Failed to create campaign'))
      }
      const json = await res.json()

      if (!isEdit && form.execution === 'now' && json.id) {
        await fetch(`/api/dashboard/campaigns/${json.id}/execute`, { method: 'POST' })
      }

      onSuccess()
      handleClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setSaving(false)
    }
  }

  const submitLabel = isEdit
    ? (saving ? tc('saving') : tc('save'))
    : (saving ? tc('creating') : tc('create'))

  return (
    <Sheet open={open} onOpenChange={(o) => !o && handleClose()}>
      <SheetContent className="w-[400px] sm:w-[540px] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{isEdit ? t('editCampaign') : t('createCampaign')}</SheetTitle>
        </SheetHeader>
        <div className="px-4 pb-4">
          <CampaignFormFields form={form} onChange={handleChange} onMemberIdsChange={handleMemberIdsChange} />
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
