'use client'

import { useState, useEffect } from 'react'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { WaTemplateFormFields } from './wa-template-form-fields'
import { initialWaTemplateForm, buildWaTemplateRequestBody, templateToFormState } from './wa-template-form-types'
import type { WaTemplateFormState } from './wa-template-form-types'
import type { WaTemplate } from '@/hooks/use-wa-templates'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
  template?: WaTemplate | null
}

export function WaTemplateFormDialog({ open, onOpenChange, onSuccess, template }: Props) {
  const isEdit = Boolean(template)
  const [form, setForm] = useState<WaTemplateFormState>(initialWaTemplateForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open && template) setForm(templateToFormState(template))
    else if (open) setForm(initialWaTemplateForm)
  }, [open, template])

  const handleClose = () => { setForm(initialWaTemplateForm); onOpenChange(false) }

  const handleChange = (key: keyof WaTemplateFormState, value: unknown) => {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  const handleSubmit = async () => {
    if (!form.name.trim()) { setError('Name is required'); return }
    if (!form.body.trim()) { setError('Body is required'); return }
    setSaving(true)
    setError(null)
    try {
      const body = buildWaTemplateRequestBody(form)
      const url = isEdit ? `/api/dashboard/wa-templates/${template!.id}` : '/api/dashboard/wa-templates'
      const method = isEdit ? 'PATCH' : 'POST'
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      if (!res.ok) throw new Error(`Failed to ${isEdit ? 'update' : 'create'} template`)
      onSuccess()
      handleClose()
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
