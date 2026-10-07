// WAQ-012: client-side fetcher for the platform-admin quality overview.
// Mirrors the shape of `usePlatformOverview` so the admin pages share a
// consistent loading/error/refetch surface.

'use client'

import { useState, useEffect, useCallback } from 'react'

export interface QualityKpis {
  totalSends: number
  delivered: number
  read: number
  failed: number
  optedOut: number
  deliveryRate: number
  readRate: number
  errorRate: number
  optOutRate: number
}

export interface TenantQualityRow {
  restaurantId: string
  restaurantName: string
  qualityRating: 'GREEN' | 'YELLOW' | 'RED' | 'UNKNOWN'
  messagingTier: string | null
  autoPauseActive: boolean
  autoPauseReason: string | null
  kpis: QualityKpis
  lastTransitionedAt: string | null
}

interface QualityOverviewPayload {
  rows: TenantQualityRow[]
  windowDays: number
}

export function useQualityOverview() {
  const [data, setData] = useState<QualityOverviewPayload | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refetch = useCallback(async () => {
    try {
      setIsLoading(true)
      setError(null)
      const res = await fetch('/api/admin/quality')
      if (!res.ok) throw new Error('Failed to fetch')
      const json = (await res.json()) as QualityOverviewPayload
      setData(json)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    refetch()
  }, [refetch])

  return { data, isLoading, error, refetch }
}
