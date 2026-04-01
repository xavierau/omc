'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

export interface TenantFormData {
  name: string
  slug: string
  whatsappNumber: string
  kapsoPhoneNumberId: string
  metaBusinessAccountId: string
  adminEmail: string
  adminPassword: string
}

interface TenantFormProps {
  initialData?: Partial<TenantFormData>
  isEdit?: boolean
  isSubmitting: boolean
  error: string | null
  onSubmit: (data: TenantFormData) => void
  onCancel: () => void
}

function generateSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

export function TenantForm({
  initialData, isEdit, isSubmitting, error, onSubmit, onCancel,
}: TenantFormProps) {
  const t = useTranslations('admin')
  const tc = useTranslations('common')
  const [form, setForm] = useState<TenantFormData>({
    name: initialData?.name ?? '',
    slug: initialData?.slug ?? '',
    whatsappNumber: initialData?.whatsappNumber ?? '',
    kapsoPhoneNumberId: initialData?.kapsoPhoneNumberId ?? '',
    metaBusinessAccountId: initialData?.metaBusinessAccountId ?? '',
    adminEmail: initialData?.adminEmail ?? '',
    adminPassword: '',
  })
  const [slugTouched, setSlugTouched] = useState(false)
  const [validationErrors, setValidationErrors] = useState<string[]>([])

  useEffect(() => {
    if (!slugTouched && !isEdit) {
      setForm(prev => ({ ...prev, slug: generateSlug(prev.name) }))
    }
  }, [form.name, slugTouched, isEdit])

  function updateField(field: keyof TenantFormData, value: string) {
    setForm(prev => ({ ...prev, [field]: value }))
    if (field === 'slug') setSlugTouched(true)
  }

  function validate(): string[] {
    const errs: string[] = []
    if (!form.name.trim()) errs.push(t('nameRequired'))
    if (!form.slug.trim()) errs.push(t('slugRequired'))
    if (!form.whatsappNumber.trim()) errs.push(t('whatsappRequired'))
    if (!form.kapsoPhoneNumberId.trim()) errs.push(t('kapsoRequired'))
    if (!isEdit && !form.adminEmail.trim()) errs.push(t('emailRequired'))
    if (!isEdit && form.adminPassword.length < 8) errs.push(t('passwordRequired'))
    return errs
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const errs = validate()
    if (errs.length) { setValidationErrors(errs); return }
    setValidationErrors([])
    onSubmit(form)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 max-w-lg">
      {(error || validationErrors.length > 0) && (
        <div className="text-sm text-destructive space-y-1">
          {error && <p>{error}</p>}
          {validationErrors.map((e) => <p key={e}>{e}</p>)}
        </div>
      )}
      <FormField label={t('restaurantName')} value={form.name} onChange={v => updateField('name', v)} />
      <FormField label={t('slugField')} value={form.slug} onChange={v => updateField('slug', v)} />
      <FormField label={t('whatsappNumber')} value={form.whatsappNumber} onChange={v => updateField('whatsappNumber', v)} />
      <FormField label={t('kapsoPhoneNumberId')} value={form.kapsoPhoneNumberId} onChange={v => updateField('kapsoPhoneNumberId', v)} />
      <FormField
        label={`${t('metaBusinessAccountId')} ${t('metaBusinessAccountIdOptional')}`}
        value={form.metaBusinessAccountId}
        onChange={v => updateField('metaBusinessAccountId', v)}
      />
      {!isEdit && (
        <>
          <FormField label={t('adminEmail')} type="email" value={form.adminEmail} onChange={v => updateField('adminEmail', v)} />
          <FormField label={t('adminPassword')} type="password" value={form.adminPassword} onChange={v => updateField('adminPassword', v)} />
        </>
      )}
      <div className="flex gap-3 pt-2">
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? tc('saving') : (isEdit ? tc('save') : tc('create'))}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel}>{tc('cancel')}</Button>
      </div>
    </form>
  )
}

function FormField({ label, value, onChange, type = 'text' }: {
  label: string; value: string; onChange: (v: string) => void; type?: string
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium text-foreground">{label}</label>
      <Input type={type} value={value} onChange={e => onChange(e.target.value)} />
    </div>
  )
}
