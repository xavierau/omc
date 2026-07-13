'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

interface Props {
  initialHelpEnabled: boolean
}

export function FallbackHelpSection({ initialHelpEnabled }: Props) {
  const t = useTranslations('settings')
  const [enabled, setEnabled] = useState(initialHelpEnabled)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    setError(null)
    setSaved(false)
    setSaving(true)
    try {
      const res = await fetch('/api/dashboard/settings/fallback-help', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ helpEnabled: enabled }),
      })
      if (!res.ok) throw new Error('Failed to save')
      setSaved(true)
    } catch {
      setError(t('helpSaveFailed'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('helpOptionTitle')}</CardTitle>
        <p className="text-sm text-muted-foreground">
          {t('helpOptionDescription')}
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <label className="flex items-center gap-3 text-sm text-foreground">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => {
              setEnabled(e.target.checked)
              setSaved(false)
            }}
            className="size-4 accent-primary"
          />
          <span className="flex-1">{t('helpOptionToggleLabel')}</span>
        </label>
        <div className="flex items-center gap-3">
          <Button onClick={save} disabled={saving}>
            {saving ? t('saving') : t('save')}
          </Button>
          {saved && (
            <p className="text-xs text-muted-foreground">{t('redirectSaved')}</p>
          )}
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
      </CardContent>
    </Card>
  )
}
