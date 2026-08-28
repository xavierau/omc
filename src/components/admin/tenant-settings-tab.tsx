'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { TenantForm, type TenantFormData } from '@/components/admin/tenant-form'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { TenantDetail } from '@/hooks/use-admin-tenant-detail'

function isTrialExpired(tenant: TenantDetail): boolean {
  if (tenant.status !== 'trial' || !tenant.trialExpiresAt) return false
  return new Date(tenant.trialExpiresAt) < new Date()
}

function statusBadgeVariant(status: string) {
  if (status === 'active') return 'default' as const
  if (status === 'trial') return 'outline' as const
  return 'secondary' as const
}

export function TenantSettingsTab({ tenant, onSaved }: { tenant: TenantDetail; onSaved: () => void }) {
  const t = useTranslations('admin')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState(tenant.status)
  const [trialExpiresAt, setTrialExpiresAt] = useState(tenant.trialExpiresAt?.split('T')[0] ?? '')
  const [savingStatus, setSavingStatus] = useState(false)

  async function handleSubmit(data: TenantFormData) {
    setIsSubmitting(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/tenants/${tenant.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!res.ok) throw new Error(t('tenantUpdateError'))
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('tenantUpdateError'))
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleSaveStatus() {
    if (status === 'trial' && !trialExpiresAt) return
    setSavingStatus(true)
    setError(null)
    try {
      const body = { status, trialExpiresAt: status === 'trial' ? trialExpiresAt : null }
      const res = await fetch(`/api/admin/tenants/${tenant.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error(t('tenantUpdateError'))
      onSaved()
    } catch {
      setError(t('tenantUpdateError'))
    } finally {
      setSavingStatus(false)
    }
  }

  return (
    <div className="space-y-6">
      {isTrialExpired(tenant) && (
        <div className="rounded-md bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800">
          {t('trialExpiredWarning')}
        </div>
      )}
      <StatusControl
        currentStatus={tenant.status}
        status={status}
        onStatusChange={(v: string) => setStatus(v as 'active' | 'inactive' | 'trial')}
        trialExpiresAt={trialExpiresAt}
        onTrialExpiresAtChange={setTrialExpiresAt}
        saving={savingStatus}
        onSave={handleSaveStatus}
      />
      <TenantForm
        initialData={{
          name: tenant.name, slug: tenant.slug,
          whatsappNumber: tenant.whatsappNumber,
          kapsoPhoneNumberId: tenant.kapsoPhoneNumberId,
          metaBusinessAccountId: tenant.metaBusinessAccountId ?? '',
        }}
        isEdit isSubmitting={isSubmitting} error={error}
        onSubmit={handleSubmit} onCancel={() => window.history.back()}
      />
    </div>
  )
}

function StatusControl({ currentStatus, status, onStatusChange, trialExpiresAt, onTrialExpiresAtChange, saving, onSave }: {
  currentStatus: string; status: string; onStatusChange: (v: string) => void
  trialExpiresAt: string; onTrialExpiresAtChange: (v: string) => void
  saving: boolean; onSave: () => void
}) {
  const tc = useTranslations('common')
  const t = useTranslations('admin')
  const changed = status !== currentStatus
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="space-y-1">
        <label className="text-sm font-medium">{t('statusLabel')}</label>
        <select value={status} onChange={e => onStatusChange(e.target.value)}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm">
          <option value="active">{tc('active')}</option>
          <option value="inactive">{tc('inactive')}</option>
          <option value="trial">{t('trial')}</option>
        </select>
      </div>
      {status === 'trial' && (
        <div className="space-y-1">
          <label className="text-sm font-medium">{t('trialExpiresAt')}</label>
          <Input type="date" value={trialExpiresAt}
            onChange={e => onTrialExpiresAtChange(e.target.value)} required className="w-44" />
        </div>
      )}
      <Badge variant={statusBadgeVariant(currentStatus)}>{currentStatus}</Badge>
      {changed && (
        <Button size="sm" disabled={saving || (status === 'trial' && !trialExpiresAt)} onClick={onSave}>
          {saving ? tc('saving') : t('updateStatus')}
        </Button>
      )}
    </div>
  )
}
