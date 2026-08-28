'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { WaTemplateFormFields } from './wa-template-form-fields'
import { readSubmitOutcome } from './wa-template-submit'
import {
  initialWaTemplateForm,
  buildWaTemplateRequestBody,
  templateToFormState,
  validateWaTemplateButtons,
} from './wa-template-form-types'
import type { WaTemplateFormState } from './wa-template-form-types'
import type { WaTemplate } from '@/hooks/use-wa-templates'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
  template?: WaTemplate | null
}

export function WaTemplateFormDialog({ open, onOpenChange, onSuccess, template }: Props) {
  const t = useTranslations('waTemplates')
  const isEdit = Boolean(template)
  const [form, setForm] = useState<WaTemplateFormState>(initialWaTemplateForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [refetchOnClose, setRefetchOnClose] = useState(false)

  useEffect(() => {
    if (open && template) setForm(templateToFormState(template))
    else if (open) setForm(initialWaTemplateForm)
  }, [open, template])

  const closeSheet = () => {
    setForm(initialWaTemplateForm)
    setError(null)
    setRefetchOnClose(false)
    onOpenChange(false)
  }

  const handleClose = () => {
    if (refetchOnClose) onSuccess()
    closeSheet()
  }

  const handleChange = (key: keyof WaTemplateFormState, value: unknown) => {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  const handleSubmit = async () => {
    if (!form.name.trim()) { setError('Name is required'); return }
    if (!form.body.trim()) { setError('Body is required'); return }
    const buttonError = validateWaTemplateButtons(form.buttons)
    if (buttonError) { setError(buttonError); return }
    setSaving(true)
    setError(null)
    try {
      const body = buildWaTemplateRequestBody(form)
      const url = isEdit ? `/api/dashboard/wa-templates/${template!.id}` : '/api/dashboard/wa-templates'
      const method = isEdit ? 'PATCH' : 'POST'
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const outcome = await readSubmitOutcome(res, t('submitFailed'))
      if (outcome.close) { onSuccess(); closeSheet(); return }
      // A rejected/unconfigured submit still saved a row, but refetching now would
      // unmount this sheet mid-error (the page swaps in a skeleton while loading)
      // and take the reason with it — so refresh the list once the user closes.
      if (outcome.refetch) setRefetchOnClose(true)
      setError(outcome.error)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setSaving(false)
    }
  }

  const title = isEdit ? 'Edit WhatsApp Template' : 'Create WhatsApp Template'
  const submitLabel = saving ? (isEdit ? 'Updating...' : 'Creating...') : (isEdit ? 'Update' : 'Create')

  return (
    <Sheet open={open} onOpenChange={(o) => !o && handleClose()}>
      <SheetContent className="w-[400px] sm:w-[540px] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
        </SheetHeader>
        <div className="px-4 pb-4">
          <WaTemplateFormFields form={form} onChange={handleChange} />
          {error && <p className="text-sm text-destructive mt-2">{error}</p>}
          <div className="flex gap-2 mt-6">
            <Button onClick={handleSubmit} disabled={saving}>{submitLabel}</Button>
            <Button variant="outline" onClick={handleClose}>Cancel</Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
