'use client'

import { useState, useEffect, useCallback } from 'react'
import type { ReferrerListItem } from './use-admin-referrers'

export interface ReferrerCommissionItem {
  id: string
  referrerId: string
  month: string
  tenantId: string
  tenantName: string
  messagesSent: number
  commissionPerMessage: number
  totalCommission: number
  status: string
  paidAt: string | null
  createdAt: string
}

export interface ReferrerEarnings {
  total: number
  pending: number
}

export function useReferrerDetail(id: string) {
  const [referrer, setReferrer] = useState<ReferrerListItem | null>(null)
  const [earnings, setEarnings] = useState<ReferrerEarnings | null>(null)
  const [commissions, setCommissions] = useState<ReferrerCommissionItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchDetail = useCallback(async () => {
    try {
      setIsLoading(true)
      setError(null)
      const res = await fetch(`/api/admin/referrers/${id}`)
      if (!res.ok) throw new Error('Failed to fetch referrer')
      const json = await res.json()
      setReferrer(json.referrer)
      setEarnings(json.earnings)
      setCommissions(json.recentCommissions ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setIsLoading(false)
    }
  }, [id])

  useEffect(() => { fetchDetail() }, [fetchDetail])

  return { referrer, earnings, commissions, isLoading, error, mutate: fetchDetail }
}
