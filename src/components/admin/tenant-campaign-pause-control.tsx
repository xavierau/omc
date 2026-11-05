'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export function TenantCampaignPauseControl({ tenantId, paused, reason, onToggled }: {
  tenantId: string; paused: boolean; reason: string | null; onToggled: () => void
}) {
  const [pauseReason, setPauseReason] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handlePause = async () => {
    if (!pauseReason.trim()) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/tenants/${tenantId}/campaign-pause`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: pauseReason }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError(body.error ?? 'Failed to pause campaigns')
        return
      }
      setPauseReason('')
      onToggled()
    } finally { setLoading(false) }
  }

  const handleResume = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/tenants/${tenantId}/campaign-pause`, { method: 'DELETE' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError(body.error ?? 'Failed to resume campaigns')
        return
      }
      onToggled()
    } finally { setLoading(false) }
  }

  return (
    <Card size="sm">
      <CardHeader><CardTitle>Campaign Status</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm">
          Status: <strong className={paused ? 'text-red-600' : 'text-green-600'}>{paused ? 'Paused' : 'Active'}</strong>
          {paused && reason && <span className="text-muted-foreground ml-2">({reason})</span>}
        </p>
        {error && <p className="text-sm text-red-600">{error}</p>}
        {paused ? (
          <Button size="sm" variant="outline" onClick={handleResume} disabled={loading}>
            {loading ? 'Resuming...' : 'Resume Campaigns'}
          </Button>
        ) : (
          <div className="flex gap-2 items-end">
            <div className="space-y-1">
              <label className="text-sm font-medium">Reason</label>
              <Input value={pauseReason} onChange={(e) => setPauseReason(e.target.value)} placeholder="Reason for pausing" className="w-64" />
            </div>
            <Button size="sm" variant="destructive" onClick={handlePause} disabled={loading || !pauseReason.trim()}>
              {loading ? 'Pausing...' : 'Pause Campaigns'}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
