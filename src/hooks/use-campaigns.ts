'use client'

import { useState, useEffect, useCallback } from 'react'
import { useTenant } from '@/hooks/use-tenant'
import type { Campaign } from '@/domain/entities/campaign'

export type { Campaign }

export function useCampaigns() {
  const { restaurantId } = useTenant()
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchCampaigns = useCallback(async () => {
    if (!restaurantId) return
    try {
      setIsLoading(true)
      setError(null)
      const res = await fetch('/api/dashboard/campaigns')
      if (!res.ok) throw new Error('Failed to fetch campaigns')
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
