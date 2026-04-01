'use client'

import { useState, useEffect, useCallback } from 'react'
import { useTenant } from '@/hooks/use-tenant'

export interface RecentEvent {
  id: string
  type: string
  memberName: string | null
  dataJson: Record<string, unknown>
  createdAt: string
}

export interface DashboardOverview {
  totalMembers: number
  newMembersToday: number
  totalPointsIssued: number
  activeCampaigns: number
  redemptionRate: number
  recentEvents: RecentEvent[]
}

export function useDashboardOverview() {
  const { restaurantId } = useTenant()
  const [data, setData] = useState<DashboardOverview | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchOverview = useCallback(async () => {
    if (!restaurantId) return
    try {
      setIsLoading(true)
      setError(null)
      const res = await fetch('/api/dashboard/overview')
      if (!res.ok) throw new Error('Failed to fetch')
      const json = await res.json()
      setData(json)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setIsLoading(false)
    }
  }, [restaurantId])

  useEffect(() => {
    fetchOverview()
  }, [fetchOverview])

  return { data, isLoading, error, refetch: fetchOverview }
}
