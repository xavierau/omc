'use client'

import { useState, useEffect, useCallback } from 'react'
import type { BillingReport } from '@/application/get-billing-report'

export type { TenantBillingRow, BillingReport } from '@/application/get-billing-report'

export function useBillingReport(month?: string) {
  const [data, setData] = useState<BillingReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchReport = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const params = month ? `?month=${month}` : ''
      const res = await fetch(`/api/admin/billing${params}`)
      if (!res.ok) throw new Error('Failed to fetch billing report')
      const json = await res.json()
      setData(json)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [month])

  useEffect(() => {
    fetchReport()
  }, [fetchReport])

  return { data, loading, error, refetch: fetchReport }
}
