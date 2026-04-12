'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import type { ReferrerListItem } from '@/hooks/use-admin-referrers'

interface ReferrerFormDialogProps {
  open: boolean
  onClose: () => void
  onSaved: () => void
  referrer?: ReferrerListItem | null
}

interface FormState {
  name: string
  contactEmail: string
  contactPhone: string
  commissionPerMessageHkd: string
  status: string
}

const initialForm: FormState = {
  name: '', contactEmail: '', contactPhone: '', commissionPerMessageHkd: '', status: 'active',
}

const selectClass = 'h-8 w-full rounded-md border border-input bg-background px-3 text-sm'

export function ReferrerFormDialog({ open, onClose, onSaved, referrer }: ReferrerFormDialogProps) {
  const t = useTranslations('admin')
  const tc = useTranslations('common')
  const [form, setForm] = useState<FormState>(initialForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const isEdit = !!referrer

  useEffect(() => {
    if (referrer) {
      setForm({
        name: referrer.name,
        contactEmail: referrer.contactEmail,
        contactPhone: referrer.contactPhone ?? '',
        commissionPerMessageHkd: referrer.commissionPerMessageHkd.toString(),
        status: referrer.status,
      })
    } else {
      setForm(initialForm)
    }
  }, [referrer, open])

  const handleSubmit = async () => {
    if (!form.name.trim()) { setError(t('referrerNameRequired')); return }
    if (!form.contactEmail.trim()) { setError(t('referrerEmailRequired')); return }
    setSaving(true)
    setError(null)
    try {
      const body = buildRequestBody(form, isEdit)
      const url = isEdit ? `/api/admin/referrers/${referrer!.id}` : '/api/admin/referrers'
      const method = isEdit ? 'PATCH' : 'POST'
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      if (!res.ok) throw new Error('Failed to save referrer')
      onSaved()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-[400px] sm:w-[540px] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{isEdit ? t('editReferrer') : t('createReferrer')}</SheetTitle>
        </SheetHeader>
        <div className="px-4 pb-4">
          <ReferrerFormFields form={form} setForm={setForm} isEdit={isEdit} />
          {error && <p className="text-sm text-destructive mt-2">{error}</p>}
          <div className="flex gap-2 mt-6">
            <Button onClick={handleSubmit} disabled={saving}>{saving ? tc('saving') : tc('save')}</Button>
            <Button variant="outline" onClick={onClose}>{tc('cancel')}</Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}

function ReferrerFormFields({ form, setForm, isEdit }: {
  form: FormState; setForm: (f: FormState) => void; isEdit: boolean
}) {
  const t = useTranslations('admin')
  const tc = useTranslations('common')
  const u = (key: keyof FormState, value: string) => setForm({ ...form, [key]: value })

  return (
    <div className="space-y-4 mt-4">
      <Field label={t('referrerName')}>
        <Input value={form.name} onChange={(e) => u('name', e.target.value)} placeholder={t('referrerNamePlaceholder')} />
      </Field>
      <Field label={t('contactEmail')}>
        <Input type="email" value={form.contactEmail} onChange={(e) => u('contactEmail', e.target.value)} placeholder="email@example.com" />
      </Field>
      <Field label={t('contactPhone')}>
        <Input value={form.contactPhone} onChange={(e) => u('contactPhone', e.target.value)} placeholder="+852 1234 5678" />
      </Field>
      <Field label={t('commissionRate')}>
        <Input type="number" step="0.01" value={form.commissionPerMessageHkd} onChange={(e) => u('commissionPerMessageHkd', e.target.value)} placeholder="0.05" />
      </Field>
      {isEdit && (
        <Field label={tc('status')}>
          <select value={form.status} onChange={(e) => u('status', e.target.value)} className={selectClass}>
            <option value="active">{tc('active')}</option>
            <option value="inactive">{tc('inactive')}</option>
          </select>
        </Field>
      )}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="text-sm font-medium text-foreground mb-1 block">{label}</label>{children}</div>
}

function buildRequestBody(form: FormState, isEdit: boolean) {
  const body: Record<string, unknown> = {
    name: form.name,
    contactEmail: form.contactEmail,
    contactPhone: form.contactPhone || null,
    commissionPerMessageHkd: form.commissionPerMessageHkd ? Number(form.commissionPerMessageHkd) : null,
  }
  if (isEdit) body.status = form.status
  return body
}
