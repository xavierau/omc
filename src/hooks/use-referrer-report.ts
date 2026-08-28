'use client'

import { useState, useEffect, useCallback } from 'react'
import type { ReferrerReport } from '@/application/generate-referrer-report'

export type {
  CommissionRow,
  ReferrerReport,
} from '@/application/generate-referrer-report'

export function useReferrerReport(month?: string) {
  const [data, setData] = useState<ReferrerReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchReport = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const params = month ? `?month=${month}` : ''
      const res = await fetch(`/api/admin/referrers/report${params}`)
      if (!res.ok) throw new Error('Failed to fetch referrer report')
      const json: ReferrerReport = await res.json()
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
