'use client'

import { useTranslations } from 'next-intl'
import { Input } from '@/components/ui/input'
import { generateSlug } from '@/domain/services/slug'
import type { StepProps } from './types'

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

export function StepTenantInfo({ data, onChange }: StepProps) {
  const t = useTranslations('admin')
  const to = useTranslations('onboarding')

  function handleNameChange(name: string) {
    onChange({ name, slug: generateSlug(name) })
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">{to('tenantInfoTitle')}</h2>
        <p className="text-sm text-muted-foreground">{to('tenantInfoDescription')}</p>
      </div>
      <FormField label={t('restaurantName')} value={data.name} onChange={handleNameChange} />
      <FormField label={t('slugField')} value={data.slug} onChange={v => onChange({ slug: v })} />
      <FormField label={t('adminEmail')} type="email" value={data.adminEmail} onChange={v => onChange({ adminEmail: v })} />
      <FormField label={t('adminPassword')} type="password" value={data.adminPassword} onChange={v => onChange({ adminPassword: v })} />
      <FormField label={t('whatsappNumber')} value={data.whatsappNumber} onChange={v => onChange({ whatsappNumber: v })} />
    </div>
  )
}
