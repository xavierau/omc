'use client'

import { useState, useEffect, useCallback } from 'react'
import type { MonthlyUsageSummary } from '@/domain/services/campaign-cost'

export function useCampaignUsage(tenantId: string, month?: string) {
  const [data, setData] = useState<MonthlyUsageSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchUsage = useCallback(async () => {
    if (!tenantId) return
    try {
      setLoading(true)
      setError(null)
      const params = month ? `?month=${month}` : ''
      const res = await fetch(
        `/api/admin/tenants/${tenantId}/campaign-usage${params}`
      )
      if (!res.ok) throw new Error('Failed to fetch campaign usage')
      const json = await res.json()
      setData(json)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [tenantId, month])

  useEffect(() => {
    fetchUsage()
  }, [fetchUsage])

  return { data, loading, error, refetch: fetchUsage }
}
