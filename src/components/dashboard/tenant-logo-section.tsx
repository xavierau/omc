'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ImageUploader } from '@/components/dashboard/image-uploader'

export function TenantLogoSection({ initialLogoUrl }: { initialLogoUrl: string | null }) {
  const t = useTranslations('settings')
  const [logoUrl, setLogoUrl] = useState(initialLogoUrl ?? '')
  const [saving, setSaving] = useState(false)

  async function saveLogo(url: string | null) {
    setSaving(true)
    try {
      const res = await fetch('/api/dashboard/settings/logo', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ logoUrl: url }),
      })
      if (!res.ok) throw new Error('Failed to save')
      setLogoUrl(url ?? '')
    } catch {
      // revert on failure
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('logoTitle')}</CardTitle>
        <p className="text-sm text-muted-foreground">{t('logoDescription')}</p>
      </CardHeader>
      <CardContent>
        <ImageUploader
          bucket="tenant-assets"
          currentUrl={logoUrl}
          onUploaded={(url) => saveLogo(url)}
          onRemoved={() => saveLogo(null)}
        />
        {saving && <p className="text-xs text-muted-foreground mt-2">{t('saving')}</p>}
      </CardContent>
    </Card>
  )
}
