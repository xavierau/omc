'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { TenantForm, type TenantFormData } from '@/components/admin/tenant-form'

export default function NewTenantPage() {
  const router = useRouter()
  const t = useTranslations('admin')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(data: TenantFormData) {
    setIsSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/tenants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? t('tenantCreateError'))
      }
      const created = await res.json()
      router.push(`/admin/tenants/${created.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('tenantCreateError'))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-foreground">{t('newTenantHeading')}</h1>
      <TenantForm
        isSubmitting={isSubmitting}
        error={error}
        onSubmit={handleSubmit}
        onCancel={() => router.push('/admin/tenants')}
      />
    </div>
  )
}
