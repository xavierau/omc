'use client'

import { useEffect, useState } from 'react'
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

  if (loading) return <StatusSkeleton />
  if (!data?.template) return <NoTemplate />

  const regionCount = (data.template as { regions?: unknown[] }).regions?.length ?? 0

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Receipt Template
          <Badge variant="secondary">Active</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm text-muted-foreground">
        <p>Regions detected: <span className="font-medium text-foreground">{regionCount}</span></p>
        <p>Threshold: <span className="font-medium text-foreground">{data.threshold ?? 'N/A'}</span></p>
        <Button variant="outline" size="sm" onClick={onRebuild}>Rebuild Template</Button>
      </CardContent>
    </Card>
  )
}

function StatusSkeleton() {
  return (
    <Card>
      <CardContent className="py-6 text-center text-sm text-muted-foreground">
        Loading template status...
      </CardContent>
    </Card>
  )
}

function NoTemplate() {
  return (
    <Card>
      <CardContent className="py-6 text-center text-sm text-muted-foreground">
        No receipt template configured. Upload sample receipts to enable layout verification.
      </CardContent>
    </Card>
  )
}
