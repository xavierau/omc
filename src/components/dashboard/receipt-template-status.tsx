'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

interface TemplateData {
  template: Record<string, unknown> | null
  threshold?: number
}

export function ReceiptTemplateStatus({ refreshKey, onRebuild }: {
  refreshKey: number
  onRebuild: () => void
}) {
  const t = useTranslations('receiptTemplate')
  const [data, setData] = useState<TemplateData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchTemplate()
  }, [refreshKey])

  async function fetchTemplate() {
    setLoading(true)
    try {
      const res = await fetch('/api/dashboard/templates')
      if (!res.ok) throw new Error('Failed')
      setData(await res.json())
    } catch {
      setData(null)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="py-6 text-center text-sm text-muted-foreground">
          {t('loadingStatus')}
        </CardContent>
      </Card>
    )
  }

  if (!data?.template) {
    return (
      <Card>
        <CardContent className="py-6 text-center text-sm text-muted-foreground">
          {t('noTemplate')}
        </CardContent>
      </Card>
    )
  }

  const regionCount = (data.template as { regions?: unknown[] }).regions?.length ?? 0

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {t('templateTitle')}
          <Badge variant="secondary">{t('active')}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm text-muted-foreground">
        <p>{t('regionsDetected')} <span className="font-medium text-foreground">{regionCount}</span></p>
        <p>{t('threshold')} <span className="font-medium text-foreground">{data.threshold ?? 'N/A'}</span></p>
        <Button variant="outline" size="sm" onClick={onRebuild}>{t('rebuildTemplate')}</Button>
      </CardContent>
    </Card>
  )
}
