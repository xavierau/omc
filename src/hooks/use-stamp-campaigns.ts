'use client'

import { useState, useEffect, useCallback } from 'react'
import { useTenant } from '@/hooks/use-tenant'

// View shape returned by GET /api/dashboard/campaigns/stamps (matches the server's
// StampCampaignView). Read-only on the client; transitions go through the PATCH route.
export interface StampCampaign {
  id: string
  name: string
  nameZh: string | null
  stampsRequired: number
  rewardId: string
  status: 'draft' | 'active' | 'paused' | 'ended'
  maxStampsPerDay: number
  honorUntil: string | null
}

export function useStampCampaigns() {
  const { restaurantId } = useTenant()
  const [campaigns, setCampaigns] = useState<StampCampaign[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchCampaigns = useCallback(async () => {
    if (!restaurantId) return
    try {
      setIsLoading(true)
      setError(null)
      const res = await fetch('/api/dashboard/campaigns/stamps')
      if (!res.ok) throw new Error('Failed to fetch stamp campaigns')
      const json = await res.json()
      setCampaigns(json.campaigns ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setIsLoading(false)
    }
  }, [restaurantId])

  useEffect(() => {
    fetchCampaigns()
  }, [fetchCampaigns])

  return { campaigns, isLoading, error, refetch: fetchCampaigns }
}
