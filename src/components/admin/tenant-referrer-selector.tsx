'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'

interface Referrer {
  id: string
  name: string
}

interface TenantReferrerSelectorProps {
  tenantId: string
  currentReferrerId: string | null
  onChanged: () => void
}

export function TenantReferrerSelector({ tenantId, currentReferrerId, onChanged }: TenantReferrerSelectorProps) {
  const t = useTranslations('admin')
  const [referrers, setReferrers] = useState<Referrer[]>([])
  const [value, setValue] = useState(currentReferrerId ?? '')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  useEffect(() => {
    fetch('/api/admin/referrers?status=active')
      .then(res => res.json())
      .then(json => setReferrers(json.referrers ?? []))
      .catch(() => setReferrers([]))
  }, [])

  useEffect(() => {
    setValue(currentReferrerId ?? '')
  }, [currentReferrerId])

  async function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const newValue = e.target.value
    setValue(newValue)
    setSaving(true)
    setMessage(null)
    try {
      const res = await fetch(`/api/admin/tenants/${tenantId}/referrer`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ referrerId: newValue || null }),
      })
      if (!res.ok) throw new Error()
      setMessage({ type: 'success', text: t('referrerAssigned') })
      onChanged()
    } catch {
      setValue(currentReferrerId ?? '')
      setMessage({ type: 'error', text: t('referrerAssignError') })
    } finally {
      setSaving(false)
    }
  }

  const selectClass = 'h-8 rounded-md border border-input bg-background px-3 text-sm disabled:opacity-50'

  return (
    <div>
      <label className="text-sm font-medium text-foreground mb-1 block">
        {t('assignReferrer')}
      </label>
      <select
        value={value}
        onChange={handleChange}
        disabled={saving}
        className={selectClass}
      >
        <option value="">{t('noReferrer')}</option>
        {referrers.map((r) => (
          <option key={r.id} value={r.id}>{r.name}</option>
        ))}
      </select>
      {saving && <span className="ml-2 text-xs text-muted-foreground">Saving...</span>}
      {message && (
        <p className={`text-xs mt-1 ${message.type === 'success' ? 'text-green-600' : 'text-destructive'}`}>
          {message.text}
        </p>
      )}
    </div>
  )
}
