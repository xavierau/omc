'use client'

import { useState, useEffect, useCallback } from 'react'

export interface CommissionRow {
  referrerId: string
  referrerName: string
  tenantId: string
  tenantName: string
  messagesSent: number
  commissionPerMessage: number
  totalCommission: number
}

export interface ReferrerReport {
  month: string
  commissions: CommissionRow[]
  totalCommission: number
  tenantsProcessed: number
}

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
