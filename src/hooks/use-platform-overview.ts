'use client'

import { useState, useEffect, useCallback } from 'react'

export interface PlatformOverview {
  totalTenants: number
  activeTenants: number
  inactiveTenants: number
  trialTenants: number
  totalMembers: number
  newMembers30d: number
  receiptsProcessed30d: number
  couponsRedeemed30d: number
  messagesSent30d: number
  recentTenants: RecentTenant[]
}

export interface RecentTenant {
  id: string
  name: string
  slug: string
  status: string
  memberCount: number
  createdAt: string
}

export function usePlatformOverview() {
  const [data, setData] = useState<PlatformOverview | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchOverview = useCallback(async () => {
    try {
      setIsLoading(true)
      setError(null)
      const res = await fetch('/api/admin/overview')
      if (!res.ok) throw new Error('Failed to fetch')
      const json = await res.json()
      setData(json)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchOverview()
  }, [fetchOverview])

  return { data, isLoading, error, refetch: fetchOverview }
}
