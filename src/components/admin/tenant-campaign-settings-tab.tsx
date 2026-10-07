'use client'

import { useState } from 'react'
import { useAdminCampaignSettings } from '@/hooks/use-admin-campaign-settings'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { TenantCampaignPauseControl } from '@/components/admin/tenant-campaign-pause-control'

export function TenantCampaignSettingsTab({ tenantId }: { tenantId: string }) {
  const { settings, usage, warnings, isLoading, error, refetch } = useAdminCampaignSettings(tenantId)

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading campaign settings...</p>
  if (error) return <p className="text-sm text-red-600">{error}</p>
  if (!settings) return <p className="text-sm text-muted-foreground">No settings found.</p>

  return (
    <div className="space-y-6">
      {warnings.length > 0 && <WarningList warnings={warnings} />}
      {usage && <UsageCard monthlySends={usage.monthlySends} unsubscribeRate={usage.unsubscribeRate} />}
      <SettingsForm tenantId={tenantId} settings={settings} onSaved={refetch} />
      <TenantCampaignPauseControl tenantId={tenantId} paused={settings.paused ?? false} reason={settings.pauseReason ?? null} onToggled={refetch} />
    </div>
  )
}

function WarningList({ warnings }: { warnings: string[] }) {
  return (
    <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200">
      <ul className="list-disc list-inside">
        {warnings.map((w) => <li key={w}>{w}</li>)}
      </ul>
    </div>
  )
}

function UsageCard({ monthlySends, unsubscribeRate }: { monthlySends: number; unsubscribeRate: number }) {
  return (
    <Card size="sm">
      <CardHeader><CardTitle>Current Usage</CardTitle></CardHeader>
      <CardContent>
        <div className="flex gap-6 text-sm">
          <div><span className="text-muted-foreground">Monthly sends:</span> <strong>{monthlySends}</strong></div>
          <div><span className="text-muted-foreground">Unsub rate:</span> <strong>{(unsubscribeRate * 100).toFixed(1)}%</strong></div>
        </div>
      </CardContent>
    </Card>
  )
}

function SettingsForm({ tenantId, settings, onSaved }: {
  tenantId: string; settings: { monthlySendLimit: number; dailyCampaignLimit: number; maxUnsubscribeRate: number }; onSaved: () => void
}) {
  const [monthly, setMonthly] = useState(String(settings.monthlySendLimit))
  const [daily, setDaily] = useState(String(settings.dailyCampaignLimit))
  const [maxUnsub, setMaxUnsub] = useState(String(settings.maxUnsubscribeRate))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/tenants/${tenantId}/campaign-settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          monthlySendLimit: Number(monthly),
          dailyCampaignLimit: Number(daily),
          maxUnsubscribeRate: Number(maxUnsub),
        }),
      })
      if (!res.ok) throw new Error('Failed to update settings')
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card size="sm">
      <CardHeader><CardTitle>Campaign Limits</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <SettingsField label="Monthly send limit" value={monthly} onChange={setMonthly} type="number" />
        <SettingsField label="Daily campaign limit" value={daily} onChange={setDaily} type="number" />
        <SettingsField label="Max unsubscribe rate" value={maxUnsub} onChange={setMaxUnsub} type="number" step="0.01" />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <Button size="sm" onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : 'Save Settings'}</Button>
      </CardContent>
    </Card>
  )
}

function SettingsField({ label, value, onChange, type, step }: {
  label: string; value: string; onChange: (v: string) => void; type?: string; step?: string
}) {
  return (
    <div className="space-y-1">
      <label className="text-sm font-medium">{label}</label>
      <Input type={type} step={step} value={value} onChange={(e) => onChange(e.target.value)} className="w-48" />
    </div>
  )
}

